import WebSocket from 'ws';

async function test() {
  const ws = new WebSocket('ws://127.0.0.1:8787/ws');
  
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  console.log('✅ WebSocket connected to engine at 8787');

  let rpcIdCounter = 1;
  function callRpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = 'rpc-' + rpcIdCounter++;
      const handler = (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'res' && msg.id === id) {
            ws.off('message', handler);
            if (!msg.ok) reject(new Error(msg.error?.message || JSON.stringify(msg.error)));
            else resolve(msg.result);
          }
        } catch {}
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ type: 'req', v: 1, id, method, params }));
    });
  }

  // 1. 测试 capabilities
  const caps = await callRpc('capabilities.get');
  console.log('✅ capabilities.get passed:', caps);

  // 2. 测试 sessions.list
  const list = await callRpc('sessions.list');
  console.log(`✅ sessions.list passed: 共有 ${list.sessions?.length} 个真实电脑会话`);
  const targetSession = list.sessions?.find((s: any) => s.title?.includes('继续按 handoff') || s.title?.includes('handoff'));
  if (targetSession) {
    console.log(`🎯 目标电脑会话: [${targetSession.id}] ${targetSession.title}`);
    
    // 3. 测试 sessions.get
    const detail = await callRpc('sessions.get', { sessionId: targetSession.id });
    console.log(`✅ sessions.get passed: 该会话包含 ${detail.session?.turns?.length} 个回合`);
    const lastTurn = detail.session?.turns?.slice(-1)[0];
    if (lastTurn) {
      console.log(`   最新回合: role=${lastTurn.role}, blocks=${lastTurn.blocks?.length}`);
    }
  }

  ws.close();
  console.log('🎉 端到端测试完全成功！');
}

test().catch(console.error);
