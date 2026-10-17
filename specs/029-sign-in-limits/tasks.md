# Tasks: Sign-in limits that follow the client

**Input**: [spec.md](spec.md), [plan.md](plan.md)

## Slice 1: the client's address (US2)

- [x] T001 `frontend/real-ip.envsh` and the include in `nginx.conf.template`; checks of every value
- [x] T002 `scripts/test-real-ip.sh` in `make check`
- [x] T003 The two variables in both compose files, `.env.example` and the guide's Configuration table
- [ ] T004 Guide: "The client's address" with Railway (checked on the demo) and Cloudflare

## Slice 2: the known browser (US1)

- [ ] T010 Migration `023_known_browsers.sql`, the repository and its port
- [ ] T011 Limits by address, username and instance; the known browser in `Accounts.sign_in`
- [ ] T012 `tiko_device` in `api/auth.py`; rows deleted on a password change and when a person is disabled
- [ ] T013 Tests for every scenario of US1; CHANGELOG line

## Slice 3: release and the demo (US2)

- [ ] T020 Release; the demo's ENV set as the guide says; six new demo visitors from one address, the sixth refused
- [ ] T021 Cloudflare in front of the demo, the platform's own address of the service removed
