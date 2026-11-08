import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.domain.errors import SecretKeyMissing, SecretUnreadable


class FernetSecretBox:
    def __init__(self, key: str) -> None:
        # Any string works as TIKO_SECRET_KEY; Fernet itself needs 32 url-safe base64 bytes.
        digest = hashlib.sha256(key.encode()).digest()
        self._fernet = Fernet(base64.urlsafe_b64encode(digest))

    def encrypt(self, plain: str) -> str:
        return self._fernet.encrypt(plain.encode()).decode()

    def decrypt(self, token: str) -> str:
        try:
            return self._fernet.decrypt(token.encode()).decode()
        except InvalidToken as exc:
            raise SecretUnreadable("stored token was encrypted with a different key") from exc


class NullSecretBox:
    def encrypt(self, plain: str) -> str:
        raise SecretKeyMissing("Set TIKO_SECRET_KEY in .env to store tokens and passwords.")

    def decrypt(self, token: str) -> str:
        raise SecretUnreadable("TIKO_SECRET_KEY is not set")
