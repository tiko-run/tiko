---
title: CalDAV tasks
description: Put the tasks of a CalDAV server, such as Nextcloud or Radicale, on a board, including the ones you add in Thunderbird or Apple Reminders.
---

Tasks of a CalDAV server become live cards on any tiko. tiko reads the server, not an app: whatever Thunderbird, Apple Reminders, DAVx⁵ or the Nextcloud Tasks app write there shows up on the board. tiko only reads, it never changes a task.

Checked with Nextcloud and Radicale. Other CalDAV servers that keep tasks should work the same way.

## Connect your account

Each person connects their own account in **Settings → My tracker → CalDAV**. Nobody else's account is used to read your tasks, and an admin sets nothing.

1. Create an app password on your server, so tiko does not hold your main password:
   - Nextcloud: **Personal settings → Security → Devices & sessions**, enter a name such as `tiko` and press **Create new app password**.
   - Radicale and most other servers: use the password of your account.
2. In tiko enter the server address, the user name and the app password, and press **Connect**.

The address can be just the domain, such as `cloud.example.com`: tiko finds your task lists by itself. A full address works too, such as `https://cloud.example.com/remote.php/dav/`. tiko answers with the name of your account, or says what went wrong.

tiko stores the password encrypted and never shows it again. To connect again with the same address and user name, leave the password blank. A new address or user name needs the password again, so it never reaches a server it was not typed for.

The instance needs `TIKO_SECRET_KEY` set to store the password, see [Configuration](../configuration/).

## Choose the lists

Once connected, **Settings → My tracker** lists your task lists with a switch each. A list switched off does not show in the card tool. Calendars that hold only events are left out by themselves.

## Add cards

Pick the card tool (`C`) and switch to **CalDAV**. Type a few words of a task's title: tiko searches all your lists at once, or one list picked in the menu next to the search. Tick the tasks you want, search again for more, and press **Add**. With an empty search the tasks due soonest come first. Done tasks are hidden until you turn on **Show done**.

A task you create later in your app does not appear on the board by itself: add it the same way.

A CalDAV card shows its list where other cards show a key. Click it for the mini-card: the due date and the start date, the progress, whether it repeats, the parent task of a subtask, and the categories as chips. On Nextcloud the mini-card links to the task in the Tasks app; other servers have no page for a task, so there is no link.

| On the server | On the card |
|---|---|
| Needs action, or no status | To do |
| In process | In progress |
| Completed | Done |
| Cancelled | Cancelled |

Apple Reminders has no cancelled state: a cancelled task it syncs comes back as open, on the server and so on the card.

A task you move to another list in your app stays on the board: tiko finds it again in its new list. A repeating task is one card for the whole series.

## Who sees what

Cards are read with the account of the person looking at the board. A teammate sees your CalDAV card only with an account of their own that can read the same list, such as a list you shared with them in Nextcloud. Otherwise they see the card with a prompt to connect an account.

## A server on your home network

A server on the internet must use `https://`. A server on a private network, such as a Nextcloud or Radicale at home, may use plain `http://`.

Whoever runs tiko can turn off connections to private networks with `TIKO_CALDAV_PRIVATE_NETWORK=deny`, see [Configuration](../configuration/). A public instance should: otherwise its people could reach machines on the instance's own network.
