import type { ISkill, SkillConfig } from '../types/skill';

/**
 * Skill 注册表
 * 管理所有可用Skill的注册、发现与生命周期
 */
export class SkillRegistry {
  private skills: Map<string, ISkill> = new Map();
  private configs: Map<string, SkillConfig> = new Map();

  /**
   * 注册一个Skill
   */
  register(skill: ISkill): void {
    if (this.skills.has(skill.id)) {
      console.warn(`[SkillRegistry] Skill "${skill.id}" already registered, overwriting.`);
    }
    this.skills.set(skill.id, skill);
    this.configs.set(skill.id, skill.config);
    console.log(`[SkillRegistry] Registered skill: ${skill.id} v${skill.version}`);
  }

  /**
   * 批量注册
   */
  registerMany(skills: ISkill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  /**
   * 注销Skill
   */
  unregister(skillId: string): boolean {
    const existed = this.skills.delete(skillId);
    this.configs.delete(skillId);
    if (existed) {
      console.log(`[SkillRegistry] Unregistered skill: ${skillId}`);
    }
    return existed;
  }

  /**
   * 获取Skill实例
   */
  get(skillId: string): ISkill | undefined {
    return this.skills.get(skillId);
  }

  /**
   * 获取Skill配置
   */
  getConfig(skillId: string): SkillConfig | undefined {
    return this.configs.get(skillId);
  }

  /**
   * 获取所有已注册Skill
   */
  getAll(): ISkill[] {
    return Array.from(this.skills.values());
  }

  /**
   * 获取所有配置
   */
  getAllConfigs(): SkillConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * 检查Skill是否存在
   */
  has(skillId: string): boolean {
    return this.skills.has(skillId);
  }

  /**
   * 获取已启用的Skill
   */
  getEnabled(): ISkill[] {
    return this.getAll().filter(s => s.config.enabled);
  }

  /**
   * 按依赖顺序排序Skill
   * 返回的数组保证：依赖项在被依赖项之前
   */
  resolveDependencies(skillIds: string[]): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    const visit = (id: string, path: Set<string> = new Set()) => {
      if (path.has(id)) {
        throw new Error(`[SkillRegistry] Circular dependency detected: ${Array.from(path).join(' -> ')} -> ${id}`);
      }
      if (visited.has(id)) return;

      const skill = this.skills.get(id);
      if (!skill) {
        throw new Error(`[SkillRegistry] Skill "${id}" not found.`);
      }

      path.add(id);
      for (const dep of skill.config.dependencies) {
        visit(dep, new Set(path));
      }
      path.delete(id);

      visited.add(id);
      result.push(id);
    };

    for (const id of skillIds) {
      visit(id);
    }

    return result;
  }

  /**
   * 验证所有Skill的依赖是否满足
   */
  validateDependencies(): { valid: boolean; missing: string[] } {
    const allIds = new Set(this.skills.keys());
    const missing: string[] = [];

    for (const skill of this.skills.values()) {
      for (const dep of skill.config.dependencies) {
        if (!allIds.has(dep)) {
          missing.push(`${skill.id} -> ${dep}`);
        }
      }
    }

    return { valid: missing.length === 0, missing };
  }
}

// 全局单例
export const globalSkillRegistry = new SkillRegistry();
