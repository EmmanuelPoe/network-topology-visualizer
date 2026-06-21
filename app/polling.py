import asyncio
import time
import json
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


async def check_tcp_port(
    host: str, port: int = 22, timeout: float = 1.5
) -> tuple[bool, float]:
    """
    Attempts to connect to a TCP port to check device availability and measure latency.
    Returns (is_online, latency_ms).
    """
    if not host:
        return False, 0.0

    start_time = time.perf_counter()
    try:
        # Open connection asynchronously
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=timeout
        )
        writer.close()
        await writer.wait_closed()
        latency = (time.perf_counter() - start_time) * 1000.0
        return True, round(latency, 1)
    except Exception:
        # Connection failed or timed out
        return False, 0.0


class LivePoller:
    def __init__(self, manager, interval: float = 15.0):
        self.manager = manager
        self.interval = interval
        self.task = None
        self._running = False
        self.device_states: Dict[str, Dict[str, Any]] = {}

    def start(self):
        if not self._running:
            self._running = True
            self.task = asyncio.create_task(self._run_loop())
            logger.info("Live topology poller started.")

    async def stop(self):
        self._running = False
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            logger.info("Live topology poller stopped.")

    async def _run_loop(self):
        # Allow initial application startup to complete
        await asyncio.sleep(2.0)
        while self._running:
            try:
                await self.poll_now()
            except Exception as e:
                logger.error(f"Error in poller iteration: {e}", exc_info=True)
            await asyncio.sleep(self.interval)

    async def poll_now(self):
        if (
            not self.manager.latest_topology
            or "devices" not in self.manager.latest_topology
        ):
            return

        devices = self.manager.latest_topology["devices"]
        tasks = []
        device_ids = []

        for d in devices:
            ip = d.get("ip")
            device_id = d.get("id")
            device_ids.append(device_id)

            # Check if this device is simulated/mock
            is_mock_ip = not ip or ip.startswith("10.99.")
            is_mock_platform = (
                "mock" in d.get("platform", "").lower() if d.get("platform") else False
            )
            is_mock_id = device_id.startswith("mock") or "internet" in device_id.lower()

            if is_mock_ip or is_mock_platform or is_mock_id:
                # Simulate status and latency
                tasks.append(self._simulate_device_check(device_id))
            else:
                # Real TCP check
                tasks.append(check_tcp_port(ip, port=22, timeout=2.0))

        results = await asyncio.gather(*tasks)

        status_updates = {}
        for device_id, (is_online, latency) in zip(device_ids, results):
            status_updates[device_id] = {"online": is_online, "latency": latency}
            # Cache states
            self.device_states[device_id] = {
                "online": is_online,
                "latency": latency,
                "last_check": time.time(),
            }

        # Broadcast status updates to all active WebSocket connections
        payload = {"type": "status_update", "statuses": status_updates}
        await self.manager.broadcast_text(json.dumps(payload))

    async def _simulate_device_check(self, device_id: str) -> tuple[bool, float]:
        # Hash value to yield stable results
        hash_val = sum(ord(c) for c in device_id)

        # Simulate Access-3 going offline on a 2-minute cycle for visual feedback
        current_minutes = int(time.time() / 60)
        is_online = True

        # Make one access switch blink offline/online every alternate 2 minutes
        if ("access-1-3" in device_id.lower() or "access-3" in device_id.lower()) and (
            current_minutes % 4 < 2
        ):
            is_online = False

        latency = 0.0
        if is_online:
            if "core" in device_id.lower() or "internet" in device_id.lower():
                latency = round(1.2 + (hash_val % 4) * 0.3, 1)
            elif "dist" in device_id.lower():
                latency = round(4.5 + (hash_val % 6) * 0.5, 1)
            else:
                latency = round(12.8 + (hash_val % 10) * 1.2, 1)

        await asyncio.sleep(0.01)  # Yield
        return is_online, latency
