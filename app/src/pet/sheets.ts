import type { ImageSourcePropType } from 'react-native';

import type { PetRole } from './types';

/**
 * 内置 sprite sheet。名称与 pack.json 的 animations key 对齐；
 * 外部 pack 走文件 URI，不进这张表。
 */
export const PET_SHEETS: Record<PetRole, Record<string, ImageSourcePropType>> = {
  deepy: {
    idle: require('../../assets/pets/deepy/sheets/idle.png'),
    thinking: require('../../assets/pets/deepy/sheets/thinking.png'),
    working: require('../../assets/pets/deepy/sheets/working.png'),
    juggling: require('../../assets/pets/deepy/sheets/juggling.png'),
    sweeping: require('../../assets/pets/deepy/sheets/sweeping.png'),
    attention: require('../../assets/pets/deepy/sheets/attention.png'),
    notification: require('../../assets/pets/deepy/sheets/notification.png'),
    error: require('../../assets/pets/deepy/sheets/error.png'),
    carrying: require('../../assets/pets/deepy/sheets/carrying.png'),
    sleeping: require('../../assets/pets/deepy/sheets/sleeping.png'),
    waking: require('../../assets/pets/deepy/sheets/waking.png'),
    roam: require('../../assets/pets/deepy/sheets/roam.png'),
    'react-left': require('../../assets/pets/deepy/sheets/react-left.png'),
    'react-right': require('../../assets/pets/deepy/sheets/react-right.png'),
    'react-tickle': require('../../assets/pets/deepy/sheets/react-tickle.png'),
    'react-drag': require('../../assets/pets/deepy/sheets/react-drag.png'),
  },
  maid: {
    idle: require('../../assets/pets/maid/sheets/idle.png'),
    thinking: require('../../assets/pets/maid/sheets/thinking.png'),
    working: require('../../assets/pets/maid/sheets/working.png'),
    juggling: require('../../assets/pets/maid/sheets/juggling.png'),
    sweeping: require('../../assets/pets/maid/sheets/sweeping.png'),
    attention: require('../../assets/pets/maid/sheets/attention.png'),
    notification: require('../../assets/pets/maid/sheets/notification.png'),
    error: require('../../assets/pets/maid/sheets/error.png'),
    carrying: require('../../assets/pets/maid/sheets/carrying.png'),
    sleeping: require('../../assets/pets/maid/sheets/sleeping.png'),
    waking: require('../../assets/pets/maid/sheets/waking.png'),
    roam: require('../../assets/pets/maid/sheets/roam.png'),
    'react-left': require('../../assets/pets/maid/sheets/react-left.png'),
    'react-right': require('../../assets/pets/maid/sheets/react-right.png'),
    'react-tickle': require('../../assets/pets/maid/sheets/react-tickle.png'),
    'react-drag': require('../../assets/pets/maid/sheets/react-drag.png'),
  },
};
