import { readFile } from 'fs/promises';
import { configSchema, type ValidatedConfig } from './schema.js';

export class ConfigManager {
  constructor(private configPath: string) {}

  async load(): Promise<ValidatedConfig> {
    const raw = await readFile(this.configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return configSchema.parse(parsed);
  }
}
