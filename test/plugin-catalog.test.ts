import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  PLUGIN_COMPAT,
  PLUGIN_COMPAT_SNAPSHOT,
  effectiveTierCounts,
  filterPlugins,
  pluginSearchText,
  tierSummary,
} from '../app/src/lib/pluginCatalog';

interface RawReportEntry {
  name: string;
  version: string;
  tier: string;
  effectiveTier: string;
  reasons: string[];
}

const report = JSON.parse(readFileSync('reports/plugin-compat.json', 'utf8')) as RawReportEntry[];

describe('插件兼容数据', () => {
  it('App 数据与 reports/plugin-compat.json 同步', () => {
    assert.equal(PLUGIN_COMPAT.length, report.length);
    assert.equal(PLUGIN_COMPAT_SNAPSHOT.packages, report.length);
    const byName = new Map(PLUGIN_COMPAT.map((entry) => [entry.name, entry]));
    for (const item of report) {
      const entry = byName.get(item.name);
      assert.ok(entry, `缺少 ${item.name}`);
      assert.equal(entry.version, item.version, item.name);
      assert.equal(entry.tier, item.tier, item.name);
      assert.equal(entry.effectiveTier, item.effectiveTier, item.name);
      assert.deepEqual(entry.reasons, item.reasons, item.name);
    }
    assert.equal(new Set(PLUGIN_COMPAT.map((entry) => entry.name)).size, PLUGIN_COMPAT.length);
  });

  it('按含依赖等级计数与矩阵一致', () => {
    assert.deepEqual(effectiveTierCounts(), {
      L0: 64,
      L1: 131,
      L2: 66,
      L3: 43,
      L4: 0,
      'no-code': 1,
    });
    assert.match(tierSummary(), /^305 个包 · /);
    assert.match(tierSummary(), /L3 43/);
  });

  it('搜索包名、理由和内建模块', () => {
    const chat = filterPlugins(PLUGIN_COMPAT, 'dsh-client-ui-chat', 'all');
    assert.equal(chat[0]?.name, '@deepseek-ai/dsh-client-ui-chat');
    assert.equal(chat[0]?.effectiveTier, 'L0');

    const child = filterPlugins(PLUGIN_COMPAT, 'child_process', 'all');
    assert.ok(child.length > 0);
    assert.ok(child.every((entry) => pluginSearchText(entry).includes('child_process')));

    const exact = filterPlugins(PLUGIN_COMPAT, 'dsh-web-app', 'all');
    assert.equal(exact[0]?.name, '@deepseek-ai/dsh-web-app');

    const chained = filterPlugins(PLUGIN_COMPAT, 'dsh session', 'all');
    assert.ok(chained.length > 0);
    assert.ok(chained.every((entry) => /dsh/i.test(entry.name) && /session/i.test(pluginSearchText(entry))));
  });

  it('等级过滤看含依赖等级，结果按轻到重排序', () => {
    const l3 = filterPlugins(PLUGIN_COMPAT, '', 'L3');
    assert.equal(l3.length, 43);
    assert.ok(l3.every((entry) => entry.effectiveTier === 'L3'));

    const all = filterPlugins(PLUGIN_COMPAT, '', 'all');
    assert.equal(all.length, 305);
    assert.equal(all[0]?.effectiveTier, 'L0');
    assert.equal(all[all.length - 1]?.effectiveTier, 'L3');
  });

  it('空结果不崩溃', () => {
    assert.deepEqual(filterPlugins(PLUGIN_COMPAT, 'definitely-no-such-plugin', 'all'), []);
  });
});
