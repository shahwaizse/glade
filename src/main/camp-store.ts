import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CampRecord,
  CampRegistryState,
  CreateCampInput,
  HostRuntimeInfo,
} from "../shared/types";
import { getHostRuntimeInfo, resolveCampDefinition } from "./workspace";

interface PersistedCampRegistry {
  activeCampId: string | null;
  camps: CampRecord[];
  version: 1;
}

const EMPTY_REGISTRY: PersistedCampRegistry = {
  activeCampId: null,
  camps: [],
  version: 1,
};

export class CampStore {
  private state: PersistedCampRegistry = {
    activeCampId: null,
    camps: [],
    version: 1,
  };

  constructor(
    private readonly storagePath: string,
    private readonly seedPath: string,
  ) {}

  async initialize() {
    this.state = await this.load();

    if (this.state.camps.length === 0) {
      try {
        await this.addCamp({ rootPath: this.seedPath });
      } catch {
        await this.save();
      }
      return;
    }

    if (!this.state.activeCampId || !this.state.camps.some((camp) => camp.id === this.state.activeCampId)) {
      this.state.activeCampId = this.state.camps[0]?.id ?? null;
      await this.save();
    }
  }

  getCamp(campId?: string) {
    const resolvedId = campId ?? this.state.activeCampId;
    if (!resolvedId) {
      return null;
    }

    return this.state.camps.find((camp) => camp.id === resolvedId) ?? null;
  }

  getRegistry(): CampRegistryState {
    return {
      activeCampId: this.state.activeCampId,
      camps: [...this.state.camps],
      host: getHostRuntimeInfo(),
    };
  }

  async addCamp(input: CreateCampInput): Promise<CampRegistryState> {
    const camp = await resolveCampDefinition(input);
    const existing = this.state.camps.find(
      (entry) =>
        entry.environment === camp.environment &&
        entry.rootPath === camp.rootPath &&
        entry.wslDistro === camp.wslDistro,
    );

    if (existing) {
      this.touchCamp(existing.id);
      await this.save();
      return this.getRegistry();
    }

    this.state.camps = [camp, ...this.state.camps];
    this.state.activeCampId = camp.id;
    await this.save();
    return this.getRegistry();
  }

  async setActiveCamp(campId: string): Promise<CampRegistryState> {
    if (!this.getCamp(campId)) {
      throw new Error(`Unknown camp: ${campId}`);
    }

    this.touchCamp(campId);
    await this.save();
    return this.getRegistry();
  }

  async removeCamp(campId: string): Promise<CampRegistryState> {
    this.state.camps = this.state.camps.filter((camp) => camp.id !== campId);

    if (this.state.activeCampId === campId) {
      this.state.activeCampId = this.state.camps[0]?.id ?? null;
    }

    await this.save();
    return this.getRegistry();
  }

  private touchCamp(campId: string) {
    const camp = this.state.camps.find((entry) => entry.id === campId);
    if (!camp) {
      return;
    }

    camp.lastOpenedAt = new Date().toISOString();
    this.state.activeCampId = campId;
    this.state.camps = [
      camp,
      ...this.state.camps.filter((entry) => entry.id !== campId),
    ];
  }

  private async load(): Promise<PersistedCampRegistry> {
    try {
      const content = await readFile(this.storagePath, "utf8");
      const parsed = JSON.parse(content) as Partial<PersistedCampRegistry>;
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.camps)) {
        return {
          activeCampId: null,
          camps: [],
          version: 1,
        };
      }

      return {
        activeCampId: parsed.activeCampId ?? null,
        camps: parsed.camps.filter(Boolean),
        version: 1,
      };
    } catch {
      return {
        activeCampId: null,
        camps: [],
        version: 1,
      };
    }
  }

  private async save() {
    await mkdir(path.dirname(this.storagePath), { recursive: true });
    await writeFile(this.storagePath, JSON.stringify(this.state, null, 2));
  }
}
