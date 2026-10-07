# America 250 Mall Ops

An interactive 3D exercise model of the National Mall for Saturday, July 4, 2026 (America 250). It was built as a live demo for the Big City Emergency Managers meeting. It is a fictional tabletop exercise built from public information, not an operational tool.

## Files

| File | Use |
|---|---|
| `index.html` | Page source published as a claude.ai Artifact. Live AI features (Ask the AI, decision critique, curveball injects, after-action report) only run inside Claude. |
| `standalone.html` | The same page with a full HTML wrapper, for opening straight from a laptop browser. It needs internet access for three.js and fonts. AI features fall back to the built-in exercise guidance. |

## What's in it

- A stylized 3D model of DC built from public geography: Mall landmarks, about 800 city blocks, the Potomac, Metro stations, and a crowd model of 16,000 points.
- 9 scripted injects (an MSEL) from 12:15 to about 23:00, across ESF-1, 6, 8, 9, 12, 13 and 15. Each has a decision point with three options, simulated consequences and planner guidance.
- An exercise clock with a time-lapse sky, a storm, fireworks over the Reflecting Pool, and post-fireworks egress toward Metro.
- Four simulated sensor feeds (EO, IR and night vision) rendered from virtual cameras in the model.
- Live AI (through the Artifact `sample` capability), which:
  - answers questions using the current exercise picture
  - critiques each decision
  - turns any what-if from the room into a new inject on the map
  - drafts an HSEEP-style after-action report
- AI-generated aerial stills, linked from site and incident cards and labeled as simulated.

## Presenter flow (about 5 minutes)

1. Press **Next inject** and talk through the decision. Pick an option, then press **Critique my call**.
2. Ask the room for a what-if, type it into **Throw a curveball**, and let the AI build it onto the map.
3. Jump to the storm at 19:55. Shelter or evacuate? Watch the crowd move and the fireworks shift.
4. Finish with **Generate after-action report** and **How this was built**.
