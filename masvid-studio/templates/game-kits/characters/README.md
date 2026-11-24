# Animated character kit

Offline rigged characters for authored games. Inspect with `node scripts/game-glb-inspect.mjs templates/game-kits/characters/Mage.glb`. Triangle counts are mesh-definition totals, not per-frame rendered counts. Durations are seconds from embedded animation time accessors; zero-duration clips are poses.

## Mage

12 meshes; 1 skin; 41 unique bones; 5683 triangles; 12 clips.

| Clip | Duration (s) |
|---|---:|
| 1H_Melee_Attack_Chop | 1.066667 |
| 1H_Ranged_Shoot | 1.066667 |
| Block | 1.066667 |
| Cheer | 1.666667 |
| Death_A | 0.8 |
| Dodge_Forward | 0.4 |
| Hit_A | 0.666667 |
| Idle | 1.066667 |
| Jump_Full_Short | 1.166667 |
| Running_A | 0.8 |
| Spellcast_Shoot | 0.933333 |
| Walking_A | 1.066667 |

## Knight

15 meshes; 1 skin; 41 unique bones; 6952 triangles; 12 clips.

| Clip | Duration (s) |
|---|---:|
| 1H_Melee_Attack_Chop | 1.066667 |
| 1H_Ranged_Shoot | 1.066667 |
| Block | 1.066667 |
| Cheer | 1.666667 |
| Death_A | 0.8 |
| Dodge_Forward | 0.4 |
| Hit_A | 0.666667 |
| Idle | 1.066667 |
| Jump_Full_Short | 1.166667 |
| Running_A | 0.8 |
| Spellcast_Shoot | 0.933333 |
| Walking_A | 1.066667 |

## Acknowledgements

KayKit Adventurers 1.0 by Kay Lousberg (KayKit Game Assets), CC0. Mage.glb and Knight.glb are the supplied originals trimmed to 12 common clips (Idle, Walking_A, Running_A, Jump_Full_Short, Dodge_Forward, Spellcast_Shoot, 1H_Melee_Attack_Chop, 1H_Ranged_Shoot, Block, Hit_A, Death_A, Cheer) so each file stays under 1 MiB; meshes, skin and bones are unchanged. The full 76-clip packs are available from KayKit. See [LICENSE-KayKit.txt](./LICENSE-KayKit.txt). Attribution is retained for provenance although CC0 does not require it.
