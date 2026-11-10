---
title: API keys
description: Personal keys that let your scripts reach tiko as you.
---

An API key lets a script reach tiko as you, without your password. It sees what you see on your boards, and nothing more.

## Make a key

1. Open Settings → API keys and press **New key**.
2. Give it a name you will recognise later, such as the laptop or the script it is for.
3. Choose what it may do: read, or read and write. A key that writes can add to the boards you can edit and lay them out; it never changes the words of, or removes, what people made.
4. Choose the boards it reaches: all of yours, or only the ones you tick. A key for chosen boards never sees the others.
5. Choose how long it lives: 7, 30, 90 or 365 days. No key lives forever.
6. Enter your password and copy the key. tiko shows it once and keeps only a fingerprint of it, so nobody can read it back, you included.

Whatever the key reads leaves tiko through the program that holds it. Give it only to software you trust with those boards.

## Use a key

Send it in the `Authorization` header to the API under `/api/v1/`:

```bash
curl -H "Authorization: Bearer tiko_…" https://tiko.example.com/api/v1/me
```

`/api/v1/me` answers with your name, your workspace and what the key may do. What else the API reads is in [API](../api/).

The API takes keys only, never the browser's sign-in, and a key opens nothing outside `/api/v1/`.

## When a key stops working

- You revoke it in Settings → API keys, or it expires.
- You press "Sign out everywhere" in Settings → Security, or reset your password with a reset link.
- An admin disables your account or removes you from the workspace.

Changing your password yourself keeps your keys; tiko tells you how many stay active. Another tiko process may take up to 30 seconds to notice a revoked key.

The API answers a stopped key with `401` and says why: `token_revoked`, `token_expired`, or `auth_required` for a key it does not know.

## For admins

API keys can be switched on and off in Settings → Workspace → Sharing. A new tiko starts with them on; a tiko updated from an earlier version starts with them off, so you decide whether people may send boards to other programs. While they are off, nobody can make a key and every key answers `403 api_disabled`; switching them on again brings the keys back.

The switch shows how many keys are in use. Admins never see the keys themselves, and a key gives an admin no more than any member: only boards they own, were shared, or that are shared with everyone.
