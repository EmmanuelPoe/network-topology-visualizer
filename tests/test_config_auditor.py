from app.auditor import audit_device_config, audit_topology


def test_audit_device_config_vulnerabilities():
    insecure_config = """!
hostname Core-Switch-1
enable password insecure_cleartext
no service password-encryption
!
interface GigabitEthernet1/1
 ip address 10.0.0.1 255.255.255.0
!
line vty 0 4
 transport input telnet
!
snmp-server community public RO
snmp-server community private RW
!
end"""

    findings = audit_device_config(insecure_config)

    # Verify unencrypted enable password is flagged
    assert any(f["title"] == "Unencrypted Enable Password" for f in findings)

    # Verify password encryption disabled is flagged
    assert any(f["title"] == "Password Encryption Disabled" for f in findings)

    # Verify insecure management protocol (Telnet) is flagged
    assert any(
        f["title"] == "Insecure Management Protocol (Telnet) Allowed" for f in findings
    )

    # Verify weak SNMP community strings are flagged
    assert any(f["title"] == "Weak SNMP Community String (public)" for f in findings)
    assert any(f["title"] == "Weak SNMP Community String (private)" for f in findings)

    # Verify missing operational best practices are flagged
    assert any(f["title"] == "Syslog Logging Disabled" for f in findings)
    assert any(f["title"] == "Missing Login Banner (MOTD)" for f in findings)


def test_audit_device_config_healthy():
    secure_config = """!
hostname Secure-Switch-1
enable secret secure_hash
service password-encryption
ip domain-name enterprise.net
!
interface GigabitEthernet1/1
 ip address 10.0.0.1 255.255.255.0
!
line vty 0 4
 transport input ssh
!
logging 10.0.0.100
banner motd # Unauthorized Access Prohibited #
snmp-server community secure_community_string RO
!
end"""

    findings = audit_device_config(secure_config)

    # Secure config should pass all checks (findings list should be empty)
    assert len(findings) == 0


def test_audit_topology_integration():
    topology = {
        "devices": [
            {
                "id": "switch-1",
                "label": "Switch-1",
                "type": "switch",
                "layer": "access",
                "config": "enable password cisco\ntransport input telnet\n",
            }
        ],
        "links": [],
    }

    audited = audit_topology(topology)
    device = audited["devices"][0]

    assert "audit_findings" in device
    assert len(device["audit_findings"]) > 0
    assert any(
        f["title"] == "Unencrypted Enable Password" for f in device["audit_findings"]
    )
