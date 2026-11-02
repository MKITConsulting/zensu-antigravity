#!/usr/bin/env python3
"""Relay an owned native TUI to its operator; never generate tool approvals."""
import errno
import fcntl
import json
import os
import pathlib
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time
import tty


def main():
    spec_path = pathlib.Path(sys.argv[1])
    spec = json.loads(spec_path.read_text())
    run_dir = pathlib.Path(spec["runDir"])
    record = {"reason": "not-started", "exitCode": None, "operatorBytes": 0,
              "automaticInputs": [], "argv": ["agy", *spec["argv"]]}
    terminal = None
    previous = None
    child = None
    master = None

    def interrupted(number, _frame):
        raise InterruptedError("bridge-signal-" + str(number))

    for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(number, interrupted)
    try:
        terminal = os.open("/dev/tty", os.O_RDWR | os.O_NOCTTY)
        if not os.isatty(terminal):
            raise RuntimeError("Interactive live runs require a controlling terminal")
        previous = termios.tcgetattr(terminal)
        tty.setraw(terminal)
        master, slave = pty.openpty()
        size = fcntl.ioctl(terminal, termios.TIOCGWINSZ, struct.pack("HHHH", 0, 0, 0, 0))
        fcntl.ioctl(slave, termios.TIOCSWINSZ, size)

        def child_terminal():
            os.setsid()
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

        child = subprocess.Popen(["agy", *spec["argv"]], cwd=spec["ws"],
                                 stdin=slave, stdout=slave, stderr=slave,
                                 preexec_fn=child_terminal, close_fds=True)
        os.close(slave)
        record["pid"] = child.pid
        os.write(terminal, ("\r\nInteractive live probe: " + spec["ws"]
                           + "\r\nReview each tool and the selected option. Enter confirms only"
                           + " an inspected one-time choice; y/n work where supported."
                           + " Ctrl-C aborts. No navigation, paste or always/auto grants.\r\n").encode())
        started = time.monotonic()
        next_observe = started
        stable = None
        exit_sent = None
        cancel_sent = None
        with (run_dir / "terminal.raw").open("xb") as raw, \
                (run_dir / "operator-input.jsonl").open("x") as inputs:
            while child.poll() is None:
                now = time.monotonic()
                if cancel_sent is not None and exit_sent is None and now - cancel_sent >= 2:
                    # Cancellation and /exit affect only this owned probe. They
                    # are not permission answers or workflow completion claims.
                    os.write(master, b"/exit\r")
                    record["automaticInputs"].append("/exit")
                    exit_sent = now
                if now - started > spec["seconds"]:
                    record["reason"] = "timeout"
                    break
                ready, _, _ = select.select([terminal, master], [], [], 0.2)
                if terminal in ready:
                    data = os.read(terminal, 4096)
                    if not data:
                        record["reason"] = "operator-eof"
                        break
                    # A probe needs no new human prompts or menu navigation.
                    # AGY 1.4.3's creation dialog ignores the documented y key.
                    # Its highlighted one-time choice accepts an explicit Enter.
                    # The operator must inspect that choice before confirming it;
                    # navigation, persistent-choice selectors and paste stay refused.
                    if data not in (b"y", b"n", b"\r", b"\x03"):
                        inputs.write(json.dumps({"elapsed": now - started, "refused": True,
                                                 "byteCount": len(data)}) + "\n")
                        inputs.flush()
                        os.write(terminal, b"\r\nOnly y, n, inspected one-time Enter or Ctrl-C is accepted.\r\n")
                        continue
                    inputs.write(json.dumps({"elapsed": now - started,
                                             "input": data.decode("ascii")}) + "\n")
                    inputs.flush()
                    if data == b"\x03":
                        record["reason"] = "operator-abort"
                        break
                    record["operatorBytes"] += len(data)
                    # This is exactly the operator's input, never a generated yes,
                    # allowlist, global mode switch, or permission response.
                    os.write(master, data)
                if master in ready:
                    try:
                        data = os.read(master, 65536)
                    except OSError as error:
                        if error.errno == errno.EIO:
                            break
                        raise
                    if not data:
                        break
                    raw.write(data)
                    raw.flush()
                    os.write(terminal, data)
                if exit_sent is not None:
                    if now - exit_sent > 15:
                        record["reason"] = "exit-did-not-finish"
                        break
                    continue
                if cancel_sent is not None:
                    continue
                if now >= next_observe:
                    next_observe = now + 2
                    check = subprocess.run([spec["node"], spec["observer"], str(spec_path)],
                                           capture_output=True, text=True, timeout=10)
                    try:
                        proof = json.loads(check.stdout)
                    except ValueError:
                        proof = {"verified": False, "reason": "observer output unavailable"}
                    (run_dir / "latest-observation.json").write_text(json.dumps(proof, indent=2) + "\n")
                    key = (proof.get("sessionId"), proof.get("completion", {}).get("transcriptHash"),
                           proof.get("completion", {}).get("decisionsHash")) if proof.get("verified") else None
                    if key is not None and key == stable:
                        if spec.get("stopProbe") and proof.get("completion", {}).get("kind") == "stop-continuation":
                            # This bounded scenario proves Stop/continuation,
                            # not review-chain closure. Save the actual proof
                            # before cancelling the now-observed experiment.
                            (run_dir / "observed-before-cancel.json").write_text(json.dumps(proof, indent=2) + "\n")
                            os.write(master, b"\x03")
                            record["automaticInputs"].append("cancel-observed-probe")
                            record["reason"] = "stop-continuation-observed"
                            record["completion"] = proof["completion"]
                            cancel_sent = now
                            continue
                        # Two unchanged observations prove a normal idle turn.
                        # /exit closes only this process; it does not close or reset
                        # a Zensu workflow, nor approve any tool.
                        os.write(master, b"/exit\r")
                        record["automaticInputs"].append("/exit")
                        record["reason"] = "completed"
                        record["completion"] = proof["completion"]
                        exit_sent = now
                    stable = key
            if child.poll() is None and record["reason"] in ("completed", "stop-continuation-observed"):
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    record["reason"] = "exit-did-not-finish"
            if child.poll() is not None:
                record["exitCode"] = child.returncode
                if record["reason"] == "not-started":
                    record["reason"] = "native-process-exited-before-proof"
    except BaseException as error:
        record["reason"] = str(error)
    finally:
        for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            signal.signal(number, signal.SIG_IGN)
        cleanup_operation = None
        try:
            if child is not None and child.poll() is None:
                # Terminate only the process group this bridge created. A forced
                # exit is never classified as a completed native turn.
                cleanup_operation = "signal-SIGTERM"
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                cleanup_operation = "wait-after-SIGTERM"
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    cleanup_operation = "signal-SIGKILL"
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    cleanup_operation = "wait-after-SIGKILL"
                    child.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired) as error:
            # A denied signal must retain the original timeout/abort and the
            # owned PID. Never hide it behind a missing transport.json or claim
            # that cleanup succeeded; the operator must inspect this process.
            record["cleanupError"] = {
                "operation": cleanup_operation,
                "error": type(error).__name__ + ": " + str(error),
            }
            if record["reason"] in ("completed", "stop-continuation-observed"):
                record["reason"] = "cleanup-failed"
        if child is not None:
            record["exitCode"] = child.poll()
            record["processExitConfirmed"] = record["exitCode"] is not None
        if previous is not None:
            try:
                termios.tcsetattr(terminal, termios.TCSADRAIN, previous)
            except (OSError, termios.error):
                pass
        if terminal is not None:
            os.close(terminal)
        if master is not None:
            os.close(master)
        (run_dir / "transport.json").write_text(json.dumps(record, indent=2) + "\n")
    return 0 if record["reason"] in ("completed", "stop-continuation-observed") and record["exitCode"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
