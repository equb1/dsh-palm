import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  BatteryCharging,
  Bell,
  Box,
  Brain,
  Check,
  ChevronsDownUp,
  ChevronDown,
  ChevronLeft,
  CircleDot,
  Cloud,
  Copy,
  Cpu,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  File,
  FileText,
  Film,
  FlaskConical,
  Folder,
  FolderOpen,
  Globe,
  Image,
  Info,
  KeyRound,
  Laptop,
  Layers,
  LayoutGrid,
  LoaderCircle,
  Menu,
  MessageCircle,
  Music,
  Orbit,
  PanelLeft,
  PanelTop,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  SquarePen,
  SquareTerminal,
  SunMoon,
  TriangleAlert,
  Type,
  Upload,
  UserRound,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * 锦囊品牌图标系统。
 *
 * 设置/聊天过程/操作栏不再用汉字或 Unicode 符号拼图标；统一使用 1.8px
 * 线性几何图标，品牌主视觉用原生 SVG 绘制（不依赖字体，不挑 ROM）。
 */
export type BrandIconName =
  | 'menu'
  | 'sparkles'
  | 'zap'
  | 'box'
  | 'user'
  | 'key'
  | 'layers'
  | 'moon'
  | 'type'
  | 'collapse'
  | 'bell'
  | 'battery'
  | 'grid'
  | 'panel'
  | 'circleDot'
  | 'cpu'
  | 'server'
  | 'flask'
  | 'info'
  | 'upload'
  | 'fileText'
  | 'terminal'
  | 'folderOpen'
  | 'folder'
  | 'file'
  | 'puzzle'
  | 'users'
  | 'search'
  | 'settings'
  | 'back'
  | 'close'
  | 'arrowDown'
  | 'arrowUp'
  | 'copy'
  | 'share'
  | 'more'
  | 'plus'
  | 'refresh'
  | 'brain'
  | 'wrench'
  | 'globe'
  | 'shield'
  | 'check'
  | 'loader'
  | 'cloud'
  | 'laptop'
  | 'phone'
  | 'orbit'
  | 'message'
  | 'image'
  | 'video'
  | 'audio'
  | 'eye'
  | 'alert'
  | 'chevronDown'
  | 'square'
  | 'panelLeft'
  | 'sliders'
  | 'pen'
  | 'download'
  | 'external';

const ICONS = {
  menu: Menu,
  sparkles: Sparkles,
  zap: Zap,
  box: Box,
  user: UserRound,
  key: KeyRound,
  layers: Layers,
  moon: SunMoon,
  type: Type,
  collapse: ChevronsDownUp,
  bell: Bell,
  battery: BatteryCharging,
  grid: LayoutGrid,
  panel: PanelTop,
  circleDot: CircleDot,
  cpu: Cpu,
  server: Server,
  flask: FlaskConical,
  info: Info,
  upload: Upload,
  fileText: FileText,
  terminal: SquareTerminal,
  folderOpen: FolderOpen,
  folder: Folder,
  file: File,
  puzzle: Puzzle,
  users: Users,
  search: Search,
  settings: Settings2,
  back: ChevronLeft,
  close: X,
  arrowDown: ArrowDown,
  arrowUp: ArrowUp,
  copy: Copy,
  share: Share2,
  more: Ellipsis,
  plus: Plus,
  refresh: RefreshCw,
  brain: Brain,
  wrench: Wrench,
  globe: Globe,
  shield: ShieldCheck,
  check: Check,
  loader: LoaderCircle,
  cloud: Cloud,
  laptop: Laptop,
  phone: Smartphone,
  orbit: Orbit,
  message: MessageCircle,
  image: Image,
  video: Film,
  audio: Music,
  eye: Eye,
  alert: TriangleAlert,
  chevronDown: ChevronDown,
  square: Square,
  panelLeft: PanelLeft,
  sliders: SlidersHorizontal,
  pen: SquarePen,
  download: Download,
  external: ExternalLink,
} as const;

export function BrandIcon({
  name,
  size = 18,
  color = 'currentColor',
  strokeWidth = 1.8,
}: {
  name: BrandIconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}): React.ReactElement | null {
  const Icon = ICONS[name] || ICONS.info;
  if (!Icon) return null;
  return <Icon size={size} color={color} strokeWidth={strokeWidth} />;
}

/** 锦囊主视觉：几何囊袋 + 抽绳，不用汉字圆盘 */
export function BrandMark({
  size = 24,
  color,
  accent,
}: {
  size?: number;
  color: string;
  accent?: string;
}): React.ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 4.7C8.4 4.7 5.7 7.4 5.7 11.3c0 4.7 2.8 7.9 6.3 7.9s6.3-3.2 6.3-7.9c0-3.9-2.7-6.6-6.3-6.6Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Path
        d="M9.3 4.8c.3-1.4 1.4-2.3 2.7-2.3s2.4.9 2.7 2.3"
        stroke={accent ?? color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <Path
        d="M9.4 6.5c1.2 1 4 1 5.2 0"
        stroke={accent ?? color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}
