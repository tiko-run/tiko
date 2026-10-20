class DomainError(Exception):
    """Base for expected business errors; the API layer maps them to HTTP responses."""

    code = "domain_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class ValidationFailed(DomainError):
    code = "validation_failed"


class NotFound(DomainError):
    code = "not_found"


class DependencyUnavailable(DomainError):
    code = "dependency_unavailable"


class VersionConflict(DomainError):
    code = "version_conflict"


class InvalidRef(DomainError):
    code = "invalid_ref"


class InvalidJql(DomainError):
    code = "invalid_jql"


class HostMismatch(DomainError):
    code = "host_mismatch"


class TaskNotFound(DomainError):
    code = "task_not_found"


class SecretKeyMissing(DomainError):
    code = "secret_key_missing"


class SecretUnreadable(DomainError):
    code = "secret_unreadable"


class JiraNotConfigured(DomainError):
    code = "jira_not_configured"


class JiraUnauthorized(DomainError):
    code = "jira_unauthorized"


class TrackerRateLimited(DomainError):
    code = "tracker_rate_limited"

    def __init__(self, message: str, retry_after: int) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class TrackerUnavailable(DependencyUnavailable):
    code = "tracker_unavailable"


class TrackerUnreachable(TrackerUnavailable):
    """No answer at all (network, VPN, timeout): nothing reached the tracker, so no backoff."""


class TooManyRepositories(DomainError):
    code = "too_many_repositories"


class JiraRateLimited(TrackerRateLimited):
    code = "jira_rate_limited"


class JiraUnavailable(TrackerUnavailable):
    code = "jira_unavailable"


class JiraUnreachable(JiraUnavailable, TrackerUnreachable):
    """No answer at all (network, VPN, timeout): nothing reached Jira, so no backoff."""


class InvalidCredentials(DomainError):
    code = "invalid_credentials"


class AccountDisabled(DomainError):
    code = "account_disabled"


class UsernameTaken(DomainError):
    code = "username_taken"


class WeakPassword(DomainError):
    code = "weak_password"


class Forbidden(DomainError):
    code = "forbidden"


class LastAdmin(DomainError):
    code = "last_admin"


class InWorkspace(DomainError):
    code = "in_workspace"


class InviteExpired(DomainError):
    code = "invite_expired"


class OwnerRequired(DomainError):
    code = "owner_required"


class DemoFull(DomainError):
    code = "demo_full"


class BoardLimit(DomainError):
    code = "board_limit"


class TooManyAttempts(DomainError):
    code = "too_many_attempts"

    def __init__(self, message: str, retry_after: int) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class UpdateNotPossible(DomainError):
    code = "update_not_possible"


class NotEnoughSpace(DomainError):
    code = "not_enough_space"
