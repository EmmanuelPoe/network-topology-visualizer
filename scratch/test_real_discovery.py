import sys
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)

# Make sure we can import from app
sys.path.append(
    "/Users/emmanuelpoe/Documents/DEV/SourceCode/network-topology-visualizer"
)

from app.discovery import NetmikoDiscoveryEngine  # noqa: E402

engine = NetmikoDiscoveryEngine(
    seed_ip="127.0.0.1:2222",
    username="cisco",
    password="cisco",
    platform="cisco_ios",
    max_depth=2,
)

print("Starting discovery...")
result = engine.discover()
print("Discovery result:")
print(result)
