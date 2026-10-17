---
title: Why tiko
description: The mission behind tiko and the principles we use to decide what goes into it.
---

There is a new tool for work every few months. Tasks live in a tracker, docs in a wiki, talk in a chat, ideas on a whiteboard and numbers on a dashboard. Each of them was meant to make work clearer, and each holds only its own piece of the picture.

By Friday the work is spread across a dozen tabs. You know every task is written down somewhere, and you still can't say what is going on: what is stuck, who is waiting on whom, what you promised for next week. A list of forty open tickets holds all the facts and explains none of them. Adding one more tool rarely helps, and often it makes things worse.

We call this fog: the gap between what is happening with your work and what you understand about it. tiko exists to clear it.

## Mission

Help people see their work whole and understand it.

Everything below follows from that sentence. The person's understanding comes first, and we don't keep a principle for its own sake when it gets in the way.

## What we build

Five principles decide what goes into tiko. They are listed by weight. When two pull in different directions, the higher one usually wins, unless the gain on the lower side is much bigger.

### 1. Truth

A lot of fog comes from stale data. A card on a tiko board shows what your tracker says right now, and you never update it by hand. A board that drifts away from reality stops being worth opening.

Ask: will this go stale if nobody touches the board for a week?

### 2. Clarity

You shouldn't need a manual to understand a tool. Your tracker can be as complex as your team needs; the card on the board stays simple. If a feature takes more than one plain sentence to explain to someone who doesn't work in tech, we go back and rethink it.

Ask: can you explain it to your mom in one sentence?

### 3. A fresh angle

Familiar shapes hide things. A list hides how tasks connect, and a kanban board hides time. We take the views everyone knows and look at them from another side, because the usual view leaves something out. Being different is never the goal. The controls stay familiar: dragging, undo and shortcuts work the way your hands expect.

Ask: what does this show that a list or a kanban board doesn't?

### 4. Room to arrange

People understand their work in their own ways, often by moving it around with their hands. tiko gives you space and leaves the order to you. It has no built-in workflow to follow.

Ask: does this give the person freedom, or tell them how to work?

### 5. Calm

Noise is fog too. tiko doesn't ask for your attention to keep you engaged. It speaks up when something you asked about happens, like a status you are waiting for, and stays quiet otherwise.

Ask: does this help you focus, or pull you away?

### The floor: trust

You only lay out all of your work in front of something you trust. Your boards and tokens stay on your server, and you can take your data and leave at any time. Trust isn't weighed against the other principles. A feature that breaks it doesn't ship.

## How we work and talk

The same fog can settle around a project like this one. Four habits keep it away.

### Understand first

Every feature starts with the question "which fog does this clear?" That another product has it is not an answer. Without a real answer, we don't build the feature.

### Small steps

Each step is visible and works on its own, and the main branch always runs. When a plan is too big, we cut it down until the next step is obvious.

### Honesty

We describe what is there and don't promise what we don't know yet. The code, the docs and the changelog are open, and we promise something only when we know we can deliver it.

### Plain words

The interface, the docs and the release notes speak plainly. Release notes say what changed for you, not what we merged. We avoid corporate voice and jargon.

## What isn't a principle

Some things look like values but are ways to serve one:

- Self-hosting, open source, the AGPL license and a hosted plan all serve trust.
- The infinite canvas serves seeing the whole. Where a list shows the work better, we use a list.
- Live sync with your tracker serves truth.

## Change this page

These principles change as the project learns, like the rest of tiko. If one looks wrong or something is missing, start a thread in [Discussions](https://github.com/tiko-run/tiko/discussions).
