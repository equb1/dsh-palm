import type { ImageSourcePropType } from 'react-native';

import type { PetRole } from './types';

/**
 * 内置 sprite sheet。名称与 pack.json 的 animations key 对齐；
 * 外部 pack 走文件 URI，不进这张表。
 */
export const PET_SHEETS: Record<PetRole, Record<string, ImageSourcePropType>> = {
  xiaoji: {
    idle: require('../../assets/pets/xiaoji/sheets/idle.png'),
    thinking: require('../../assets/pets/xiaoji/sheets/thinking.png'),
    working: require('../../assets/pets/xiaoji/sheets/working.png'),
    juggling: require('../../assets/pets/xiaoji/sheets/juggling.png'),
    sweeping: require('../../assets/pets/xiaoji/sheets/sweeping.png'),
    attention: require('../../assets/pets/xiaoji/sheets/attention.png'),
    notification: require('../../assets/pets/xiaoji/sheets/notification.png'),
    error: require('../../assets/pets/xiaoji/sheets/error.png'),
    carrying: require('../../assets/pets/xiaoji/sheets/carrying.png'),
    sleeping: require('../../assets/pets/xiaoji/sheets/sleeping.png'),
    waking: require('../../assets/pets/xiaoji/sheets/waking.png'),
    roam: require('../../assets/pets/xiaoji/sheets/roam.png'),
    'react-left': require('../../assets/pets/xiaoji/sheets/react-left.png'),
    'react-right': require('../../assets/pets/xiaoji/sheets/react-right.png'),
    'react-tickle': require('../../assets/pets/xiaoji/sheets/react-tickle.png'),
    'react-drag': require('../../assets/pets/xiaoji/sheets/react-drag.png'),
  },
};
