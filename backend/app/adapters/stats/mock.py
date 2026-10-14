class MockStatsSender:
    """Keeps what would be sent, for tests and for runs without a collector."""

    def __init__(self) -> None:
        self.sent: list[dict] = []

    def send(self, body: dict) -> None:
        self.sent.append(body)
