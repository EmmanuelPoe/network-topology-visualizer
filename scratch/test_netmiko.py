from netmiko import ConnectHandler
import sys

conn_params = {
    "device_type": "cisco_ios",
    "host": "127.0.0.1",
    "port": 2222,
    "username": "cisco",
    "password": "cisco",
}

try:
    net_connect = ConnectHandler(**conn_params)
    print("Netmiko connected successfully!")
    print("Prompt:", net_connect.find_prompt())

    print("\n--- LLDP neighbors detail (parsed) ---")
    lldp_out = net_connect.send_command("show lldp neighbors detail", use_textfsm=True)
    print(lldp_out)

    print("\n--- CDP neighbors detail (parsed) ---")
    cdp_out = net_connect.send_command("show cdp neighbors detail", use_textfsm=True)
    print(cdp_out)

    net_connect.disconnect()
except Exception as e:
    print("Netmiko connection failed:", e)
    sys.exit(1)
