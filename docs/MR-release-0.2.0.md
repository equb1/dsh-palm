# MR: `feat/release-0.2.0` → `develop`

> 2026-11-06 夜间。分支已推送：`origin/feat/release-0.2.0`（HEAD `c8293af`）。
> 对比：https://cnb.cool/debaox3.0/test-new-technology/dsh-palm/-/compare/develop...feat/release-0.2.0

## 包含内容

- **完整引擎平权**：`sessions.delete` / `sessions.search` / `shell.run`；真实 workspaceId 映射、
  `sessions.create(workspaceId)`、`workspaces.create` 可在 `/root/work` 下建目录。
- **OAuth 取消**：桥 loopback 回调中继，用户拒绝授权立即 `account/cancelSignIn`。
- **LAN 发现（M3.2 第一步）**：hostId/name/fingerprint + mDNS + Android NsdManager + 连接页
  扫描/重连上次宿主。
- **系统入口（M3.3 第一步）**：QS 磁贴、桌面小组件、通知 ACTION_VIEW 直达会话/审批、
  常驻通知可点回 App。
- **性能**：会话抽屉空闲预挂载 + 关闭不卸载 + 去掉大层硬件纹理 + useMemo；
  展开 Janky 6.42%→3.51%，单独展开 0 掉帧。
- **构建**：just-bash 固定 browser 入口；桥约 1.6MB；软链测试在无权限环境跳过。
- **发布**：`0.2.0 (2)`，244.2MiB，sha256 `ADA52EA0…`，已同签名 `install -r`。

## 测试计划

```bash
npm --prefix app run typecheck
npm run verify                      # 315 pass / 1 skipped（Windows 软链权限）
npm run release:preflight           # PASS
npm run device:regression           # 需要先补 docs/weekly.docx fixture
```

## 风险 / 未完成

- `device:regression` 在 release 0.2.0 上 8/10 通过；全文搜索在轻会话为空/输入焦点异常时未过。
- 真机 LAN 扫描权限弹窗已出现，但当前 PC 防火墙/网络隔离导致手机 ping 不到电脑；
  PC 本机 mDNS 查询正常。需放行 5353/8788 或换可互访网段再验收。
- E2E 加密 WS、多宿主密钥/索引分仓、完整离线状态机、悬浮球未做。
- 完整引擎搜索按需扫日志，大历史首次搜索可能受 15s 请求超时限制。
- PDF/OCR/LibreOffice render/旧格式/TTS 仍按决策暂缓。
