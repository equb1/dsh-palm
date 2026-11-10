import xiaojiPack from '../../assets/pets/xiaoji/pack.json';
import { PetStateMachine } from './PetStateMachine';
import type { PetPack, PetReaction, PetState } from './types';

export * from './types';
export * from './PetRuntime';
export * from './PetStateMachine';

export const BUILTIN_PACKS: Record<string, PetPack> = {
  xiaoji: xiaojiPack as unknown as PetPack,
};

export function getPetPack(role: 'xiaoji' = 'xiaoji'): PetPack {
  return BUILTIN_PACKS[role] ?? BUILTIN_PACKS.xiaoji!;
}
