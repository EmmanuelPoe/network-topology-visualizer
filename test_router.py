#!/usr/bin/env python3
"""
Test Router Simulator — A simple Paramiko-based SSH server that mimics a Cisco IOS router.
Can be used to test the network topology visualizer's "Real SSH" terminal feature.

Usage:
  uv run python test_router.py [--port 2222]

Credentials:
  Username: cisco
  Password: cisco
"""

import sys
import socket
import threading
import argparse
import paramiko


class RouterServer(paramiko.ServerInterface):
    def __init__(self):
        self.event = threading.Event()

    def check_channel_request(self, kind, chanid):
        if kind == "session":
            return paramiko.OPEN_SUCCEEDED
        return paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_auth_password(self, username, password):
        if username == "cisco" and password == "cisco":
            return paramiko.AUTH_SUCCESSFUL
        return paramiko.AUTH_FAILED

    def check_channel_shell_request(self, channel):
        self.event.set()
        return True

    def check_channel_pty_request(
        self, channel, term, width, height, pixelwidth, pixelheight, modes
    ):
        return True


def handle_client(client_sock):
    try:
        transport = paramiko.Transport(client_sock)
        # Generate temporary RSA key for the host identification
        host_key = paramiko.RSAKey.generate(2048)
        transport.add_server_key(host_key)

        server = RouterServer()
        transport.start_server(server=server)

        chan = transport.accept(20)
        if chan is None:
            print("[-] SSH negotiation failed or timed out.")
            return

        server.event.wait(15)

        # Send Cisco-like welcome banner
        chan.send(
            "\r\n"
            "**************************************************************************\r\n"
            "*  Cisco IOS Software, Simulator Software (test_router.py)                *\r\n"
            "*  For testing real SSH Netmiko client connectivity.                      *\r\n"
            "*  Credentials: cisco / cisco                                            *\r\n"
            "**************************************************************************\r\n\r\n"
            "test-router>"
        )

        buffer = ""
        state = "user"
        hostname = "test-router"

        def get_prompt():
            if state == "user":
                return f"{hostname}>"
            elif state == "privileged":
                return f"{hostname}#"
            elif state == "config":
                return f"{hostname}(config)#"
            return ">"

        while True:
            data = chan.recv(1024)
            if not data:
                break

            text = data.decode("utf-8", errors="ignore")
            for char in text:
                if char in ["\r", "\n"]:
                    cmd = buffer.strip()
                    buffer = ""

                    # Echo newline
                    chan.send("\r\n")

                    if not cmd:
                        chan.send(get_prompt())
                        continue

                    parts = cmd.split()
                    base = parts[0].lower()

                    if base in ["exit", "quit", "end"]:
                        if state == "config":
                            state = "privileged"
                            chan.send(
                                f"% Exiting configuration mode.\r\n{get_prompt()}"
                            )
                        elif state == "privileged":
                            state = "user"
                            chan.send(get_prompt())
                        else:
                            chan.send("Connection closed by foreign host.\r\n")
                            break
                    elif base in ["enable", "en"]:
                        state = "privileged"
                        chan.send(get_prompt())
                    elif base == "disable":
                        state = "user"
                        chan.send(get_prompt())
                    elif base in ["configure", "conf"]:
                        state = "config"
                        chan.send(get_prompt())
                    elif base in ["terminal", "term"]:
                        # Ignore terminal configurations like terminal length 0
                        chan.send(get_prompt())
                    elif base in ["show", "sh"]:
                        if len(parts) > 1 and parts[1].lower() == "version":
                            chan.send(
                                "Cisco IOS Software, IOS-XE Software, Version 15.6(2)T, RELEASE SOFTWARE\r\n"
                            )
                        elif (
                            len(parts) > 2
                            and parts[1].lower() == "ip"
                            and parts[2].lower() == "interface"
                        ):
                            chan.send(
                                "Interface              IP-Address      OK? Method Status                Protocol\r\n"
                                "GigabitEthernet1/0/1   10.0.0.1        YES manual up                    up\r\n"
                                "Loopback0              127.0.0.1       YES manual up                    up\r\n"
                            )
                        else:
                            # Silence output for other show requests to let netmiko auto-setup proceed
                            pass
                        chan.send(get_prompt())
                    else:
                        # For unhandled commands, just print prompt back
                        chan.send(get_prompt())

                elif char == "\x7f" or char == "\x08":  # Backspace handling
                    if len(buffer) > 0:
                        buffer = buffer[:-1]
                        chan.send("\b \b")
                else:
                    buffer += char
                    chan.send(char)  # Echo characters back

    except Exception as e:
        print(f"[-] Error handling client connection: {e}")
    finally:
        client_sock.close()


def main():
    parser = argparse.ArgumentParser(description="Test Router Simulator")
    parser.add_argument(
        "--port", type=int, default=2222, help="Port to listen on (default: 2222)"
    )
    args = parser.parse_args()

    server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    try:
        server_sock.bind(("0.0.0.0", args.port))
        server_sock.listen(100)
        print(f"[+] Test Router SSH Simulator listening on 0.0.0.0:{args.port}...")
    except Exception as e:
        print(f"[-] Failed to bind socket: {e}")
        sys.exit(1)

    try:
        while True:
            client_sock, addr = server_sock.accept()
            print(f"[+] Connection received from {addr[0]}:{addr[1]}")
            t = threading.Thread(target=handle_client, args=(client_sock,))
            t.daemon = True
            t.start()
    except KeyboardInterrupt:
        print("\n[-] Shutting down test router...")
    finally:
        server_sock.close()


if __name__ == "__main__":
    main()
