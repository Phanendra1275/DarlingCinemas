# Existing project audit — 19 September 2026

Baseline captured in current-build/01_THEATRE_OVERVIEW.png at 1280×720. Existing development server was run and browser inspected. Open player did not open anything. Server reports document is not defined because theatre.tsx creates a canvas at module scope. Client renders despite that server failure.

No Git repository exists. Safe source checkpoint: outputs/before-reference-reconstruction.zip; file hashes: CHECKPOINT_MANIFEST.json. Do not overwrite it during reconstruction.

| Subsystem | Status | Action | Evidence and required change |
|---|---|---|---|
| Theatre | PARTIAL | MODIFY | Existing Three renderer/rounded geometry. Room 18×25×8, unlike compact reference. No speakers/plants/art/stage. |
| Camera | BROKEN | REBUILD | Camera follows player position without third-person offset. Avatar disappears. |
| Player | PARTIAL | MODIFY | Position and input refs exist. Separate physical position from camera. |
| Avatar | PARTIAL | REBUILD | Four rounded slabs; lacks arms, individual legs, hair and face. |
| Movement | PARTIAL | MODIFY | Camera-relative WASD/joystick calculation exists. Add acceleration and deceleration. |
| Physics | BROKEN | MODIFY | Seat AABB restores camera position into player target; stand point inside collider. No camera collision. |
| Seats | PARTIAL | MODIFY | Ten padded primitive recliners. Keep rounded construction and shared materials; refine back/arms/base and dimensions. |
| Seat interaction | PARTIAL | MODIFY | Proximity measured against centre; inaccessible or inconsistent interaction point. |
| Sit/stand | PARTIAL | MODIFY | Physical seat ids present. Correct pose, eye position, safe stand point. |
| Video loader | PARTIAL | KEEP | Persistent detached HTMLVideoElement, object URLs and candidate validation exist. Fix competing loads and readiness/errors. Browser flow blocked by dead opener. |
| Video texture | PARTIAL | MODIFY | Real Three VideoTexture exists. Empty element hides welcome screen. Aspect algorithm crops. |
| Playback | PARTIAL | KEEP | Play/seek/volume/rate/loop hook exists. Add reachable controls and verify real file. |
| Lighting | PARTIAL | MODIFY | Exposure 1.5, bright strips and numerous lights. Dims on sitting regardless of playback. |
| UI | BROKEN | MODIFY | Header/profile/map/player/reset and several controls are dead. Bottom floating pill differs from full-width reference bar. |
| Mobile | PARTIAL | KEEP | Analogue pointer-capture joystick and coarse-input detection. Verify touch orbit and seat flow. |
| Responsiveness | PARTIAL | MODIFY | Existing styles have 600px minimum height; unsuitable for mobile landscape. |
| Performance | PARTIAL | MODIFY | Baseline visible FPS around 70–84 on this desktop only. Repeated geometry, per-frame allocations, disposal weaknesses; mobile unmeasured. |

Stack: React, Three.js directly, Vinext/Vite, TypeScript, lucide, CSS. No R3F, Drei or physics library. Existing hooks use-local-video/use-auto-hide/use-mobile and MobileJoystick should be retained. public contains starter SVGs, no theatre models/textures. Bundled components/ui primitives are unused by cinema. db schema/auth helper are unused and outside this task. Do not add auth/catalogue/backend.

## Refreshed 20 September baseline
Git now exists. Preserved latest external changes (parameterized recliner spacing, four side steps and Darling header) in branch before-darling-final-reconstruction, commit 8c1a8bd. Screenshot DARLING_BASELINE.png. The experience clicked: no action. Fake default 35 FPS and permanently-off sound label found; both must be replaced by measured state. Local upload still inaccessible through current HUD. Canteen MISSING. Profile, seat map and reset UI remain BROKEN. Scene renderer, geometry sharing, analog joystick and persistent local-video hook retained. New source has a mismatch: floor-height ramp applies across central vertical riser as well as side steps. Fix x-dependent floor/collision together. Current TypeScript failure is unused sidebar importing missing useIsMobile alias. No R3F/Rapier packages present.
