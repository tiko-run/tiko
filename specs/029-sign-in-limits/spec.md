# Feature Specification: Sign-in limits that follow the client

**Feature Branch**: `029-sign-in-limits`

**Created**: 2026-10-17

**Status**: Approved at G1 on 2026-10-17.

## Why

Sign-in and the demo count attempts by the client's address, and the address is what nginx in the web container works out. Behind a hosting platform's own proxies that address can be the proxy's, so one client's attempts are spread over several keys while many clients share one. The limit that covers many usernames applies to everyone at once. A person should not be held up by attempts that are not theirs, and the limits should keep counting the client who makes them.

## Decisions

1. **The client's address, set per deployment.** nginx believes the proxies listed in `TIKO_TRUSTED_PROXIES` (default: the private networks it believes today) and reads the client from `TIKO_CLIENT_IP_HEADER` (default `X-Forwarded-For`). The guide's Configuration page gets a "The client's address" section with the values for Railway, checked on the demo, and for Cloudflare in front, as Cloudflare documents them; other platforms join once checked.
2. **Limits by address and by username.** Wrong passwords are counted per address (10 in 15 minutes) and per username (10 in 15 minutes). The limit for the whole instance stays as a high backstop against guessing from many addresses.
3. **A browser you signed in from before.** After a successful sign-in the browser keeps a cookie for that person (`tiko_device`, a year, `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS like the session cookie): a random token whose hash the instance keeps, like a session's. Signing in as that person from that browser is not held up by the per-username and instance limits; its own wrong passwords are counted (10 in 15 minutes), after which the cookie no longer counts as known. Signing out keeps the cookie; changing the password or disabling the person makes old cookies unknown.
4. **The demo counts visitors by the same address.** The per-address limit on new demo visitors uses the address from decision 1.
5. **No change for an instance that sets nothing.** The defaults keep today's behaviour of nginx; the new limits apply everywhere.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The owner signs in while someone guesses (Priority: P1) 🎯

**Independent Test**: an API test makes many wrong sign-ins for several usernames from other addresses, then signs in with the right password from a browser that signed in before.

**Acceptance Scenarios**:

1. **Given** a browser that signed in as a person before, **When** the instance limit or that username's limit is reached by other clients, **Then** that person signs in from that browser with the right password.
2. **Given** a browser with no such cookie, **When** that username's limit is reached, **Then** the answer is 429 with `Retry-After`, as today.
3. **Given** a cookie for a person whose password changed since, **Then** it does not count as known.
4. **Given** 10 wrong passwords from one known browser, **Then** that browser is treated as unknown until the window passes.

### User Story 2 - A limit counts the client, not the platform (Priority: P1)

**Independent Test**: on a deployment behind a platform proxy, six new demo visitors from one address in an hour; the sixth is refused, and a visitor from another address is not.

**Acceptance Scenarios**:

1. **Given** `TIKO_TRUSTED_PROXIES` and `TIKO_CLIENT_IP_HEADER` set as the guide says for the platform, **Then** the address the API receives is the client's, the same for every request of that client.
2. **Given** a client that sends its own `X-Forwarded-For` or client header, **Then** the address is still its own.
3. **Given** neither variable set, **Then** nginx resolves the address as before.

## Out of scope

- Second factor, SSO, CAPTCHA on the sign-in form.
- Limits at the network edge: they belong to each deployment; the guide names the options.
