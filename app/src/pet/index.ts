import deepyPack from '../../assets/pets/deepy/pack.json';
import maidPack from '../../assets/pets/maid/pack.json';
import xiaojiPack from '../../assets/pets/xiaoji/pack.json';
import { PetStateMachine } from './PetStateMachine';
import type { PetPack, PetReaction, PetRole, PetState } from './types';

export * from './types';
export * from './PetRuntime';
export * from './PetStateMachine';

export const BUILTIN_PACKS: Record<string, PetPack> = {
  deepy: deepyPack as unknown as PetPack,
  maid: maidPack as unknown as PetPack,
  xiaoji: xiaojiPack as unknown as PetPack,
};

/** 品牌桌宠「小寄」为默认角色；Deepy / 鲸娘 保留为可切换角色 */
export function getPetPack(role: PetRole = 'xiaoji'): PetPack {
  return BUILTIN_PACKS[role] ?? BUILTIN_PACKS.xiaoji!;
}

