# Visual gap report — baseline

| Reference shows | Existing build shows | Cause | Required correction |
|---|---|---|---|
| Compact low-ceiling room | Tall hall | 8-unit ceiling, 25-unit depth | Reduce depth/height relative to 1.8-unit avatar and recliners; compare overview. |
| Elevated diagonal overview then close avatar follow | Rear-right first-person view with no visible avatar | Camera equals player target | Separate overview and following camera; orbit about torso with offset and collisions. |
| Broad dominant 16:9 screen with towers/plants | Black 2:1 rectangle, absent props | Empty VideoTexture replaces welcome; wrong aspect | Preserve default texture until source ready, 16:9 screen, dark/gold frame, towers and plants. |
| Red rounded recliners | Dark blocky backs foreground | Material, camera and cushion sizing | Improve head/back pads, wide arms, footrests, black base, rear bronze badge. |
| Two compact raised rows | Two widely separated rows | z1.25/5.7 and oversized room | Tighten row pitch while preserving walking corridor and elevation. |
| Rectangular wall mouldings and short sconces | Uniform narrow slats and 3.8-unit luminous bars | Simplified wall builder | Broad inset panel rectangles, ribs only at divisions, shorter wall lamps. |
| Ceiling coffers and front platform | Flat empty ceiling/front | Missing geometry | Add low console/plinth, perimeter coffer and subtle trims. |
| Cream full humanoid avatar | Four slabs mostly unseen | Missing articulated limbs and follow camera | Add separate limbs, hair/face and seated pose. |
| Full-width bottom HUD | Floating pill obscures hints | CSS composition | Bottom black bar, progress edge, hints above. |
| Individual right circles and working navigation | Pill and dead buttons | Handlers missing | Wire focus/zoom/reset/settings/player; omit unsupported catalogue/social controls. |

Baseline screenshot is a different camera viewpoint from reference overview; not a pixel-difference metric. Further comparisons must label viewpoint and lighting, and retain both images. Planned passes: 1 proportions; 2 camera/screen/seats; 3 architecture/props; 4 materials/light; 5 UI/balance. These passes are not yet verified.
