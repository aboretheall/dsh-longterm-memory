// dsh-longterm-memory — Client 半 (web platform) / client half
//   1. 会话（项目）三点菜单 + 会话头部加「设为长期项目」：Host 自动建骨架、扫结构、标记。
//   2. 设置页（settings.section）查看当前项目记忆结构 + 手动初始化 / 开关长期项目。
//   1. Adds "设为长期项目 / Make long-term project" to the session menu and the session header.
//   2. A settings page showing the current project's memory tree, with a manual init button.
//
// 零内部依赖：只用注入进来的 React 与 ctx.connection.rpc / ctx.slots / 可选 ctx.get('locale')。
// No Harness Client package is imported; only React plus the injected slots/connection services.
window.__ModuleLoader__.load({
  id: 'dsh-longterm-memory',
  factory(require) {
    const React = require('react');
    const { useState, useEffect, useCallback } = React;
    const h = React.createElement;

    const CHANNEL = '/dsh-longterm-memory';
    const inject = ['slots', 'connection'];

    // ---- 轻量 i18n（无 locale 服务时退回中文） / tiny i18n with a Chinese default ----
    const NS = 'dsh-longterm-memory';
    const DICT = {
      zh: {
        adopt: '设为长期项目',
        adoptTitle: '设为长期项目：自动建记忆结构，AI 后续自动交接',
        adopting: '处理中…',
        adopted: '已设为长期项目：记忆结构已生成，AI 会自动交接',
        failed: '设置失败：',
        pageTitle: '长期项目记忆',
        pageIntro: '把项目设为「长期项目」后，AI 会在每次会话开始时自动读取交接记录、修 bug 前先检索历史、结束时写回结论。可直接在项目（会话）右侧三点菜单里一键设置。记忆根目录：',
        longTerm: '长期项目',
        on: '已开启：会话开始自动读取记忆，会话结束自动写回。',
        off: '关闭时 AI 不会自动读取/写入记忆，但已存在的文件保留。',
        init: '初始化记忆骨架',
        reinit: '重新初始化骨架',
        ready: '✓ 记忆骨架已就绪',
        notReady: '尚未初始化',
        structure: '项目记忆结构',
        loading: '加载中…',
        missing: '（未创建）',
        error: '错误：',
        rpcFailed: 'RPC 失败',
      },
      en: {
        adopt: 'Make long-term project',
        adoptTitle: 'Make long-term: build the memory skeleton now, the AI keeps the handoff afterwards',
        adopting: 'Working…',
        adopted: 'Long-term enabled: memory skeleton created, the AI will keep the handoff',
        failed: 'Failed: ',
        pageTitle: 'Long-term Project Memory',
        pageIntro: 'Once a project is marked long-term, the AI reads the handoff at the start of every session, searches past issues before touching code, and writes conclusions back at the end. The session overflow menu does this in one click. Memory root:',
        longTerm: 'Long-term project',
        on: 'On: memory is read at session start and written at session end.',
        off: 'Off: the AI neither reads nor writes memory; existing files stay untouched.',
        init: 'Initialize memory skeleton',
        reinit: 'Re-initialize skeleton',
        ready: '✓ Memory skeleton ready',
        notReady: 'Not initialized yet',
        structure: 'Project memory structure',
        loading: 'Loading…',
        missing: '（not created）',
        error: 'Error: ',
        rpcFailed: 'RPC failed',
      },
    };

    function makeTranslate(ctx) {
      let service = null;
      try { service = typeof ctx.get === 'function' ? ctx.get('locale') : undefined; } catch { service = undefined; }
      if (service && typeof service.register === 'function') {
        try {
          const disposeZh = service.register(NS, 'zh', DICT.zh);
          const disposeEn = service.register(NS, 'en', DICT.en);
          ctx.effect(() => () => {
            try { disposeZh && disposeZh(); } catch {}
            try { disposeEn && disposeEn(); } catch {}
          });
        } catch { /* 字典注册失败不影响功能 / dictionary registration is best-effort */ }
        if (typeof service.bind === 'function') {
          let bound = null;
          try { bound = service.bind(NS); } catch { bound = null; }
          if (bound) {
            return (key, fallback) => {
              try {
                const value = bound(key);
                return typeof value === 'string' && value !== '' && value !== key ? value : fallback;
              } catch { return fallback; }
            };
          }
        }
      }
      let active = 'zh';
      try {
        const snapshot = service && typeof service.getLocale === 'function' ? service.getLocale() : null;
        if (snapshot && typeof snapshot.active === 'string' && snapshot.active.startsWith('en')) active = 'en';
      } catch { active = 'zh'; }
      return (key, fallback) => (DICT[active] && DICT[active][key]) || fallback;
    }

    // ---- 轻量 toast / lightweight toast ----
    let toastEl = null;
    let toastTimer = null;
    function showToast(text) {
      if (toastEl === null) {
        toastEl = document.createElement('div');
        Object.assign(toastEl.style, {
          position: 'fixed', left: '50%', bottom: '64px', transform: 'translateX(-50%)',
          maxWidth: '84vw', zIndex: '9999', padding: '10px 14px', borderRadius: '10px',
          background: 'rgba(20,22,28,.92)', color: '#fff', fontSize: '13px', lineHeight: '1.4',
          textAlign: 'center', fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(0,0,0,.28)',
          pointerEvents: 'none', opacity: '0', transition: 'opacity .18s ease',
        });
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = text;
      requestAnimationFrame(() => { if (toastEl !== null) toastEl.style.opacity = '1'; });
      if (toastTimer !== null) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { if (toastEl !== null) toastEl.style.opacity = '0'; }, 2600);
    }

    // ---- 目录树递归渲染 / recursive tree ----
    function Tree({ tree, depth = 0, missingLabel }) {
      if (!Array.isArray(tree)) return null;
      return h('div', null, tree.map((node) => {
        const indent = depth * 16;
        if (node.type === 'file') {
          return h('div', {
            key: node.name,
            style: { paddingLeft: indent + 8, fontSize: 12, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary, #6b7280)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
          }, node.name);
        }
        const missing = node.exists === false;
        return h('div', { key: node.name },
          h('div', {
            style: {
              paddingLeft: indent, fontSize: 13, lineHeight: '24px', fontWeight: 500,
              color: missing ? 'var(--dsw-alias-label-dimmed, #9ca3af)' : 'var(--dsw-alias-label-primary, inherit)',
            },
          }, (missing ? '▫ ' : '📁 ') + node.name + (missing ? (missingLabel || '') : '')),
          node.children && node.children.length > 0 ? h(Tree, { tree: node.children, depth: depth + 1, missingLabel }) : null,
        );
      }));
    }

    // ---- 开关 / switch ----
    function Switch({ checked, disabled, onChange, label }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': checked, disabled,
        onClick: () => onChange(!checked),
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none', background: 'transparent',
          cursor: disabled ? 'default' : 'pointer', padding: 0, fontFamily: 'inherit', opacity: disabled ? 0.5 : 1,
        },
      },
        h('span', { style: { fontSize: 14, color: 'var(--dsw-alias-label-primary, inherit)' } }, label),
        h('span', {
          style: {
            width: 36, height: 20, borderRadius: 10, position: 'relative', flex: 'none',
            background: checked ? 'var(--dsw-alias-state-business-primary, #4f6ef7)' : 'var(--dsw-alias-border-l1, rgba(0,0,0,.18))',
            transition: 'background .15s ease',
          },
        },
          h('span', {
            style: {
              position: 'absolute', top: 2, width: 16, height: 16, borderRadius: '50%', background: '#fff',
              left: checked ? 18 : 2, transition: 'left .15s ease', boxShadow: '0 1px 3px rgba(0,0,0,.3)',
            },
          }),
        ),
      );
    }

    // ---- 设置面板主体 / settings page ----
    function MemorySettingsPanel({ rpcCall, t }) {
      const [status, setStatus] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);

      const load = useCallback(async () => {
        try {
          const res = await rpcCall('memory.status', {});
          if (!res || res.ok !== true) throw new Error((res && res.error && res.error.message) || t('rpcFailed', 'RPC 失败'));
          setStatus(res.value);
        } catch (e) {
          setError(e && e.message ? e.message : String(e));
        }
      }, [rpcCall, t]);

      useEffect(() => { load(); }, [load]);

      const run = async (endpoint, payload) => {
        setBusy(true); setError(null);
        try {
          const res = await rpcCall(endpoint, payload);
          if (!res || res.ok !== true) throw new Error((res && res.error && res.error.message) || t('rpcFailed', 'RPC 失败'));
          setStatus(res.value);
        } catch (e) {
          setError(e && e.message ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      };

      const longTerm = status ? status.longTerm === true : false;
      const initialized = status ? status.initialized === true : false;

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720, fontFamily: 'inherit' } },
        h('div', { style: { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } },
          t('pageIntro', '把项目设为「长期项目」后，AI 会在每次会话开始时自动读取交接记录。记忆根目录：'),
          h('code', { style: { fontSize: 12, background: 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05))', padding: '1px 6px', borderRadius: 4, fontFamily: 'ui-monospace, Menlo, monospace' } }, status ? status.rootDir : '…'),
        ),

        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          h(Switch, { checked: longTerm, disabled: busy, onChange: (v) => run('memory.setLongTerm', { enabled: v }), label: t('longTerm', '长期项目') }),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #6b7280)' } },
            longTerm ? t('on', '已开启：会话开始自动读取记忆，会话结束自动写回。') : t('off', '关闭时 AI 不会自动读取/写入记忆，但已存在的文件保留。')),
        ),

        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          h('button', {
            type: 'button', disabled: busy,
            onClick: () => run('memory.init', {}),
            style: {
              padding: '6px 14px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))',
              background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-state-business-primary, #4f6ef7))',
              color: '#fff', fontSize: 13, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1,
            },
          }, busy ? t('adopting', '处理中…') : (initialized ? t('reinit', '重新初始化骨架') : t('init', '初始化记忆骨架'))),
          h('span', { style: { fontSize: 12, color: initialized ? 'var(--dsw-alias-state-success, #16a34a)' : 'var(--dsw-alias-label-secondary, #6b7280)' } },
            initialized ? t('ready', '✓ 记忆骨架已就绪') : t('notReady', '尚未初始化')),
        ),

        error ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-danger, #dc2626)', lineHeight: '18px' } }, t('error', '错误：') + error) : null,

        h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))', paddingTop: 12 } },
          h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary, inherit)', marginBottom: 8 } }, t('structure', '项目记忆结构')),
          status ? h(Tree, { tree: status.tree, missingLabel: t('missing', '') }) : h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, t('loading', '加载中…')),
        ),
      );
    }

    // ---- 会话头部按钮 / session header button ----
    function AdoptButton({ sessionId, rpcCall, t }) {
      const [busy, setBusy] = useState(false);
      const adopt = async () => {
        setBusy(true);
        try {
          const res = await rpcCall('memory.adopt', { sessionId });
          if (res && res.ok === true) showToast(t('adopted', '已设为长期项目'));
          else showToast(t('failed', '设置失败：') + ((res && res.error && res.error.message) || ''));
        } catch (e) {
          showToast(t('failed', '设置失败：') + (e && e.message ? e.message : String(e)));
        } finally {
          setBusy(false);
        }
      };
      return h('button', {
        type: 'button', title: t('adoptTitle', '设为长期项目'), disabled: busy,
        onClick: adopt,
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 8px',
          border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))', borderRadius: 7,
          background: 'transparent', color: 'var(--dsw-alias-label-primary, inherit)',
          fontSize: 12, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
          opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap',
        },
      }, '📁 ' + (busy ? t('adopting', '处理中…') : t('adopt', '设为长期项目')));
    }

    function apply(ctx) {
      const t = makeTranslate(ctx);
      const rpcCall = (endpoint, payload) => ctx.connection.rpc.call(CHANNEL, endpoint, payload);

      // 设置页 / settings page
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'dsh-longterm-memory', order: 50,
        label: () => t('pageTitle', '长期项目记忆'),
        inject: () => ({ rpcCall, t }),
      }, MemorySettingsPanel));

      // 会话头部按钮 / session header utility
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'dsh-longterm-memory.adopt', order: 50 },
        ({ sessionId }) => h(AdoptButton, { sessionId, rpcCall, t }),
      ));

      // 会话三点菜单项 / session "..." menu item。
      // id 用包命名空间前缀，避免与宿主或其他插件抢占同一个 cell。
      ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register(
        { name: 'sidebar.workspaces.session.menu.item', id: 'dsh-longterm-memory.adopt', order: 450 },
        ({ sessionId, useMenuOpenState }) => {
          // 老版本宿主可能不注入该 hook：拿不到就退化为不主动关闭菜单。
          const closeMenu = typeof useMenuOpenState === 'function'
            ? useMenuOpenState()[1]
            : () => {};
          return h('button', {
            type: 'button', role: 'menuitem',
            onClick: async () => {
              closeMenu();
              try {
                const res = await rpcCall('memory.adopt', { sessionId });
                if (res && res.ok === true) showToast(t('adopted', '已设为长期项目'));
                else showToast(t('failed', '设置失败：') + ((res && res.error && res.error.message) || ''));
              } catch (e) {
                showToast(t('failed', '设置失败：') + (e && e.message ? e.message : String(e)));
              }
            },
          }, t('adopt', '设为长期项目'));
        },
      ));
    }

    return { inject, apply };
  },
});
