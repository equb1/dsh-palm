import deepyPack from '../../assets/pets/deepy/pack.json';
import maidPack from '../../assets/pets/maid/pack.json';
import { PetStateMachine } from './PetStateMachine';
import type { PetPack, PetReaction, PetState } from './types';

export * from './types';
export * from './PetRuntime';
export * from './PetStateMachine';

export const BUILTIN_PACKS: Record<string, PetPack> = {
  deepy: deepyPack as unknown as PetPack,
  maid: maidPack as unknown as PetPack,
};

export function getPetPack(role: 'deepy' | 'maid' = 'deepy'): PetPack {
  return BUILTIN_PACKS[role] || BUILTIN_PACKS.deepy;
}

