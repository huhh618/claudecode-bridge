import { describe, it, expect, vi } from 'vitest';
import { AdapterRegistry } from '../../../src/channels/AdapterRegistry.js';
import { TerminalAdapter } from '../../../src/channels/TerminalAdapter.js';
import { FeishuAdapter } from '../../../src/channels/FeishuAdapter.js';

describe('AdapterRegistry', () => {
  it('registers built-in adapters', () => {
    const registry = new AdapterRegistry();
    expect(registry.get('terminal')).toBeInstanceOf(TerminalAdapter);
  });

  it('initializes only enabled adapters from config', async () => {
    const registry = new AdapterRegistry();
    const terminalInit = vi.spyOn(registry.get('terminal')!, 'initialize');

    await registry.initializeAll({
      terminal: { enabled: true },
      feishu: { enabled: false, mode: 'self-built' },
    });

    expect(terminalInit).toHaveBeenCalled();
  });

  it('getAllEnabled returns only initialized and enabled adapters', async () => {
    const registry = new AdapterRegistry();
    await registry.initializeAll({
      terminal: { enabled: true },
      feishu: { enabled: true, mode: 'self-built', webhookPort: 39998, webhookPath: '/t' },
    });

    const enabled = registry.getAllEnabled();
    expect(enabled.length).toBeGreaterThanOrEqual(1);
    expect(enabled.some((a) => a.name === 'terminal')).toBe(true);
  });

  it('closeAll closes all adapters', async () => {
    const registry = new AdapterRegistry();
    await registry.initializeAll({ terminal: { enabled: true } });
    await expect(registry.closeAll()).resolves.toBeUndefined();
  });

  it('returns undefined for non-existent adapter', () => {
    const registry = new AdapterRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('getAllEnabled returns empty array when nothing is enabled', async () => {
    const registry = new AdapterRegistry();
    await registry.initializeAll({
      terminal: { enabled: false },
      feishu: { enabled: false, mode: 'self-built' },
    });
    expect(registry.getAllEnabled()).toEqual([]);
  });

  it('handles double initialize by re-initializing enabled adapters', async () => {
    const registry = new AdapterRegistry();
    const terminal = registry.get('terminal')!;
    const initSpy = vi.spyOn(terminal, 'initialize').mockResolvedValue(undefined);

    await registry.initializeAll({ terminal: { enabled: true } });
    await registry.initializeAll({ terminal: { enabled: true } });
    expect(initSpy).toHaveBeenCalledTimes(2);
  });

  it('closeAll clears enabled set', async () => {
    const registry = new AdapterRegistry();
    await registry.initializeAll({ terminal: { enabled: true } });
    await registry.closeAll();
    expect(registry.getAllEnabled()).toEqual([]);
  });
});
