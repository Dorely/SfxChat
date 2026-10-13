import { randomUUID, createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { join, isAbsolute, resolve, sep } from "node:path";
import {
  readFile,
  mkdir,
  writeFile,
  copyFile,
  stat,
  rename,
  unlink,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import {
  arrangementSchema,
  beatSeconds,
  sourceIds,
  validateArrangement,
  ENGINE_VERSION,
  arrangementLimits,
  type Arrangement,
  type ArrangementRecord,
  type SampleMap,
} from "../shared/arrangement";
import {
  applyEdits,
  transformPattern,
  localCatalog,
  type RenderInput,
} from "../shared/arrangement-operations";
import { WorkbenchError } from "../shared/workbench";
import type { WorkbenchService } from "./service";
import type { SoundfontInfo } from "./soundfont";
import type { Asset } from "../shared/types";
import { decodeAudio } from "./audio";
import { parseMidi, writeArrangementMidi } from "./midi";
import generalUserLicense from '../../resources/soundfonts/GeneralUser-GS-LICENSE.txt?raw';

export interface ArrangementJob {
  id: string;
  projectId: string;
  sessionId: string;
  requestId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  record: ArrangementRecord;
  input: RenderInput;
  assetIds: string[];
  diagnostics: unknown[];
  error?: string;
  createdAt: string;
}
const parse = <T>(row: unknown): T => {
  if (!row)
    throw new WorkbenchError("NOT_FOUND", "Arrangement or render not found.");
  return JSON.parse((row as { json: string }).json) as T;
};
async function fileHash(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export class Arrangements {
  private running?: {
    worker: Worker;
    job: ArrangementJob;
    done: Promise<void>;
  };
  private stopped = false;
  private pumping = false;
  private pumpDone?: Promise<void>;
  private cancelled = new Set<string>();
  constructor(
    private service: WorkbenchService,
    private font: () => Promise<SoundfontInfo>,
  ) {
    const rows = service.store.db
      .prepare("SELECT json FROM arrangement_jobs")
      .all();
    for (const row of rows) {
      const job = parse<ArrangementJob>(row);
      if (job.status === "running" || job.status === "queued")
        this.saveJob({
          ...job,
          status: "failed",
          error:
            "App stopped before the local render completed. Submit a new request to render again.",
        });
    }
  }
  async close() {
    this.stopped = true;
    this.running?.worker.postMessage("cancel");
    await this.pumpDone;
    for (const row of this.db.prepare("SELECT json FROM arrangement_jobs WHERE json_extract(json,'$.status')='queued'").all()) this.saveJob({ ...parse<ArrangementJob>(row), status: 'cancelled', error: 'App closed before rendering.' });
  }
  private get db() {
    return this.service.store.db;
  }
  private checkSources(doc: Arrangement, projectId: string) {
    for (const id of sourceIds(doc)) {
      const asset = this.service.store.asset(id, projectId);
      if (asset.format === "mid")
        throw new Error(
          "Sampler sources must be audio, not MIDI. Render the MIDI first.",
        );
    }
  }
  get(projectId: string, id: string, revision?: number): ArrangementRecord {
    this.service.store.project(projectId);
    const current = parse<ArrangementRecord>(
      this.db
        .prepare("SELECT json FROM arrangements WHERE id=? AND project_id=?")
        .get(id, projectId),
    );
    return revision === undefined
      ? current
      : parse<ArrangementRecord>(
          this.db
            .prepare(
              "SELECT json FROM arrangement_history WHERE id=? AND revision=?",
            )
            .get(id, revision),
        );
  }
  private async save(
    projectId: string,
    doc: Arrangement,
    origin: "user" | "agent",
    id = randomUUID(),
    expected?: number,
  ) {
    doc = validateArrangement(doc);
    if (doc.tracks.some(t => t.instrument.type === 'soundfont')) {
      if (!doc.soundfontHash) {
        const info = await this.font(), bytes = await readFile(info.path);
        const hash = createHash('sha256').update(bytes).digest('hex');
        await mkdir(join(this.service.media.root, 'banks'), { recursive: true });
        await writeFile(this.bankPath(hash), bytes, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        doc.soundfontHash = hash;
      }
      if (await fileHash(this.bankPath(doc.soundfontHash)) !== doc.soundfontHash) throw new Error('Pinned SoundFont is missing or changed.');
    }
    this.checkSources(doc, projectId);
    return this.db.transaction(() => {
      this.service.store.project(projectId);
      const old = expected === undefined ? undefined : this.get(projectId, id);
      if (old && old.revision !== expected)
        throw new WorkbenchError(
          "REVISION_CONFLICT",
          "Arrangement changed. Read the current revision before editing.",
          { revision: old.revision },
        );
      const now = new Date().toISOString(),
        record: ArrangementRecord = {
          id,
          projectId,
          revision: (old?.revision ?? 0) + 1,
          createdAt: old?.createdAt ?? now,
          updatedAt: now,
          origin,
          document: doc,
        };
      this.db
        .prepare(
          "INSERT INTO arrangements VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
        )
        .run(id, projectId, JSON.stringify(record));
      this.db
        .prepare("INSERT INTO arrangement_history VALUES (?,?,?)")
        .run(id, record.revision, JSON.stringify(record));
      this.service.store.notify();
      return record;
    })();
  }
  job(projectId: string, id: string) {
    return parse<ArrangementJob>(
      this.db
        .prepare(
          "SELECT json FROM arrangement_jobs WHERE id=? AND project_id=?",
        )
        .get(id, projectId),
    );
  }
  private saveJob(job: ArrangementJob) {
    this.db
      .prepare(
        "INSERT INTO arrangement_jobs VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
      )
      .run(job.id, job.projectId, job.requestId, JSON.stringify(job));
    this.service.store.notify();
  }
  async call(
    name: string,
    a: Record<string, any>,
    origin: "user" | "agent",
  ): Promise<unknown> {
    const { projectId, arrangementId } = a;
    switch (name) {
      case "local_catalog": {
        try { const {name, hash, presets} = await this.font(); return {...localCatalog, soundfont: {name, hash, presets}}; }
        catch (error) { return {...localCatalog, soundfont: {unavailable: error instanceof Error ? error.message : String(error)}}; }
      }
      case "arrangement_create":
        return this.save(projectId, a.document, origin);
      case "arrangement_list":
        return this.db
          .prepare(
            "SELECT json FROM arrangements WHERE project_id=? ORDER BY rowid DESC",
          )
          .all(projectId)
          .map((row) => {
            const r = parse<ArrangementRecord>(row);
            return {
              id: r.id,
              revision: r.revision,
              name: r.document.name,
              intent: r.document.intent,
              tracks: r.document.tracks.length,
              seconds: beatSeconds(r.document, r.document.length),
              updatedAt: r.updatedAt,
            };
          });
      case "arrangement_get": {
        const record = structuredClone(
            this.get(projectId, arrangementId, a.revision),
          ),
          doc = record.document;
        if (a.trackId) {
          if (!doc.tracks.some((t) => t.id === a.trackId))
            throw new Error("Track not found.");
          doc.tracks = doc.tracks.filter((t) => t.id === a.trackId);
        }
        if (a.sectionId) {
          const section = doc.sections.find((s) => s.id === a.sectionId);
          if (!section) throw new Error("Section not found.");
          doc.tracks = doc.tracks.map((t) => ({
            ...t,
            clips: t.clips.filter(
              (c) =>
                c.start < section.start + section.length &&
                c.start + c.length > section.start,
            ),
          }));
        }
        if (a.trackId || a.sectionId) {
          const ids = new Set(
            doc.tracks.flatMap((t) => t.clips.map((c) => c.patternId)),
          );
          doc.patterns = doc.patterns.filter((p) => ids.has(p.id));
        }
        if (a.summary)
          return {
            ...record,
            document: {
              ...doc,
              patterns: doc.patterns.map((p) => ({
                ...p,
                notes: undefined,
                noteCount: p.notes.length,
              })),
            },
          };
        return record;
      }
      case "arrangement_edit":
        return this.save(
          projectId,
          applyEdits(this.get(projectId, arrangementId).document, a.edits),
          origin,
          arrangementId,
          a.expectedRevision,
        );
      case "arrangement_restore":
        return this.save(
          projectId,
          this.get(projectId, arrangementId, a.sourceRevision).document,
          origin,
          arrangementId,
          a.expectedRevision,
        );
      case "arrangement_history":
        this.get(projectId, arrangementId);
        return this.db
          .prepare(
            "SELECT json FROM arrangement_history WHERE id=? ORDER BY revision DESC",
          )
          .all(arrangementId)
          .map((row) => {
            const { document, ...r } = parse<ArrangementRecord>(row);
            return { ...r, name: document.name };
          });
      case "arrangement_transform":
        return this.save(
          projectId,
          transformPattern(
            this.get(projectId, arrangementId).document,
            a.input,
          ),
          origin,
          arrangementId,
          a.expectedRevision,
        );
      case "arrangement_from_midi": {
        const asset = this.service.store.asset(a.assetId, projectId);
        if (asset.format !== "mid") throw new Error("Choose a MIDI asset.");
        const composition = parseMidi(
          await readFile(this.service.media.path(asset)),
        );
        const length = Math.max(
          1,
          ...composition.tracks.flatMap((t) =>
            t.notes.map((n) => n.startBeat + n.durationBeats),
          ),
        );
        return this.save(
          projectId,
          arrangementSchema.parse({
            name: asset.name,
            intent: `Derived from MIDI ${asset.id}: ${asset.prompt}`,
            length,
            tempos: [
              {
                beat: 0,
                bpm: composition.bpm,
                numerator: composition.timeSig?.numerator ?? 4,
                denominator: composition.timeSig?.denominator ?? 4,
              },
            ],
            patterns: composition.tracks.map((t, i) => ({
              id: `pattern-${i}`,
              name: t.name ?? `Part ${i + 1}`,
              length,
              notes: t.notes.map((n, j) => ({
                id: `n-${j}`,
                pitch: n.pitch,
                start: n.startBeat,
                duration: n.durationBeats,
                velocity: (n.velocity ?? 100) / 127,
              })),
            })),
            tracks: composition.tracks.map((t, i) => ({
              id: `track-${i}`,
              name: t.name ?? `Part ${i + 1}`,
              instrument: {
                type: "soundfont",
                params: { program: t.program ?? 0, bank: t.drums ? 128 : 0 },
              },
              clips: [
                {
                  id: `clip-${i}`,
                  name: t.name ?? "MIDI",
                  start: 0,
                  length,
                  patternId: `pattern-${i}`,
                },
              ],
            })),
          }),
          origin,
        );
      }
      case "arrangement_render": {
        const signature = JSON.stringify({
          arrangementId,
          revision: a.expectedRevision,
          input: a.input,
          sessionId: a.sessionId,
        });
        const existing = this.db
          .prepare("SELECT json FROM arrangement_jobs WHERE request_id=?")
          .get(a.requestId);
        if (existing) {
          const job = parse<ArrangementJob>(existing);
          if (
            job.projectId !== projectId ||
            JSON.stringify({
              arrangementId: job.record.id,
              revision: job.record.revision,
              input: job.input,
              sessionId: job.sessionId,
            }) !== signature
          )
            throw new Error(
              "Request ID already belongs to different render arguments.",
            );
          return job;
        }
        const record = this.get(projectId, arrangementId);
        if (record.revision !== a.expectedRevision)
          throw new WorkbenchError(
            "REVISION_CONFLICT",
            "Read the current arrangement before rendering.",
          );
        const job: ArrangementJob = {
          id: randomUUID(),
          projectId,
          sessionId: a.sessionId,
          requestId: a.requestId,
          status: "queued",
          progress: 0,
          record,
          input: a.input,
          assetIds: [],
          diagnostics: [],
          createdAt: new Date().toISOString(),
        };
        this.saveJob(job);
        if (!this.pumping) this.pumpDone = this.pump();
        return job;
      }
      case "arrangement_jobs":
        return this.db
          .prepare(
            "SELECT json FROM arrangement_jobs WHERE project_id=? ORDER BY rowid DESC",
          )
          .all(projectId)
          .map((row) => {
            const { record, ...job } = parse<ArrangementJob>(row);
            return {
              ...job,
              arrangementId: record.id,
              revision: record.revision,
              name: record.document.name,
            };
          });
      case "arrangement_job":
        return this.job(projectId, a.jobId);
      case "arrangement_cancel": {
        const job = this.job(projectId, a.jobId);
        if (job.status === "queued")
          this.saveJob({ ...job, status: "cancelled" });
        if (job.status === "running") {
          this.cancelled.add(job.id);
          if (this.running?.job.id === job.id)
            this.running.worker.postMessage("cancel");
        }
        return this.job(projectId, a.jobId);
      }
      case "arrangement_export":
        return this.export(
          projectId,
          arrangementId,
          a.revision,
          a.destination,
          a.format,
        );
      case "arrangement_import":
        return this.import(projectId, a.source, origin);
    }
  }
  async resources(
    projectId: string,
    id: string,
  ): Promise<{
    samples: SampleMap;
    bank?: Buffer;
    hashes: Record<string, string>;
  }> {
    return this.loadResources(this.get(projectId, id));
  }
  private async loadResources(record: ArrangementRecord) {
    const samples: SampleMap = {},
      hashes: Record<string, string> = {};
    let size = 0;
    for (const id of sourceIds(record.document)) {
      const asset = this.service.store.asset(id, record.projectId);
      if ((await stat(this.service.media.path(asset))).size > 64 * 1024 * 1024) throw new Error(`Sample source exceeds 64 MiB: ${asset.name}. Use a shorter source region.`);
      const bytes = await readFile(this.service.media.path(asset));
      if (createHash("sha256").update(bytes).digest("hex") !== asset.hash)
        throw new Error(`Source integrity failed: ${asset.name}`);
      const decoded = await decodeAudio(bytes, asset.format);
      size += decoded.channels.reduce((n, c) => n + c.byteLength, 0);
      if (size > arrangementLimits.sampleBytes)
        throw new Error("Arrangement sample cache exceeds 256 MiB.");
      samples[id] = decoded;
      hashes[id] = asset.hash;
    }
    let bank: Buffer | undefined, fontPath: string | undefined;
    if (record.document.tracks.some((t) => t.instrument.type === "soundfont")) {
      if (!record.document.soundfontHash) throw new Error('Save this arrangement to pin its SoundFont before rendering.');
      fontPath = this.bankPath(record.document.soundfontHash);
      bank = await readFile(fontPath);
      hashes.soundfont = createHash("sha256").update(bank).digest("hex");
      if (hashes.soundfont !== record.document.soundfontHash) throw new Error('Pinned SoundFont integrity failed.');
    }
    return { samples, hashes, bank, fontPath };
  }
  bankPath(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid SoundFont hash.');
    return join(this.service.media.root, 'banks', `${hash}.sf2`);
  }
  async bankBytes(projectId: string, hash: string) {
    const referenced = this.db.prepare('SELECT json FROM arrangements WHERE project_id=?').all(projectId).some(row => parse<ArrangementRecord>(row).document.soundfontHash === hash);
    if (!referenced) throw new Error('SoundFont is not referenced by this project.');
    const bytes = await readFile(this.bankPath(hash));
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Pinned SoundFont integrity failed.');
    return bytes;
  }
  private async pump() {
    if (this.pumping || this.stopped) return;
    this.pumping = true;
    try {
      while (!this.stopped) {
        const row = this.db
          .prepare(
            "SELECT json FROM arrangement_jobs WHERE json_extract(json,'$.status')='queued' ORDER BY rowid LIMIT 1",
          )
          .get();
        if (!row) break;
        const job = parse<ArrangementJob>(row);
        job.status = "running";
        this.saveJob(job);
        const paths: string[] = [];
        try {
          const resources = await this.loadResources(job.record);
          if (this.stopped || this.cancelled.has(job.id))
            throw new Error("Render cancelled.");
          await mkdir(this.service.media.root, { recursive: true });
          const outputs = [];
          for (
            let variation = 0;
            variation < job.input.variations;
            variation++
          ) {
            const stems = job.input.stems
              ? [
                  undefined,
                  ...job.record.document.tracks.map((t) => t.id),
                  ...job.record.document.buses.map((b) => b.id),
                ]
              : [undefined];
            for (const stem of stems) {
              const path = join(
                this.service.media.root,
                `${randomUUID()}.partial`,
              );
              paths.push(path);
              outputs.push({
                path,
                stem,
                seed: ((job.input.seed ?? job.record.document.seed) + variation) >>> 0,
                name: `${job.record.document.name}${job.input.variations > 1 ? ` · variation ${variation + 1}` : ""}${stem ? ` · ${stem}` : " · mix"}`,
              });
            }
          }
          const worker = new Worker(
            join(__dirname, "arrangement-render-worker.cjs"),
            {
              workerData: {
                document: job.record.document,
                input: job.input,
                samples: resources.samples,
                bank: resources.bank,
                outputs,
              },
            },
          );
          let finish!: () => void;
          const done = new Promise<void>((resolve) => {
            finish = resolve;
          });
          this.running = { worker, job, done };
          try {
            const results = await new Promise<any[]>((accept, reject) => {
              let settled = false;
              worker.on("message", (message) => {
                if (message.progress !== undefined) {
                  job.progress = message.progress;
                  this.saveJob(job);
                }
                if (message.error) {
                  settled = true;
                  reject(new Error(message.error));
                }
                if (message.done) {
                  settled = true;
                  accept(message.done);
                }
              });
              worker.on("error", reject);
              worker.on("exit", (code) => {
                if (!settled)
                  reject(new Error(`Render worker exited (${code}).`));
              });
            });
            if (this.stopped || this.cancelled.has(job.id))
              throw new Error("Render cancelled before registration.");
            this.service.store.project(job.projectId);
            for (const result of results) {
              const id = randomUUID(),
                path = this.service.media.path({ id, format: "wav" });
              await rename(result.path, path);
              const info = await stat(path);
              const asset: Asset = {
                id,
                projectId: job.projectId,
                name: result.name,
                description: `Local arrangement revision ${job.record.revision}`,
                tags: ["local", result.stem ? "stem" : "mix"],
                collections: [job.record.document.name],
                review: "unreviewed",
                feedback: "",
                source: "authored",
                kind: job.record.document.kind,
                format: "wav",
                hash: result.hash,
                bytes: info.size,
                duration: result.duration,
                prompt: job.record.document.intent,
                provider: null,
                model: ENGINE_VERSION,
                requestId: job.requestId,
                request: null,
                usage: null,
                parentId: null,
                createdAt: new Date().toISOString(),
                arrangementRender: {
                  record: job.record,
                  input: job.input,
                  sourceHashes: resources.hashes,
                  seed: result.seed,
                  stem: result.stem,
                  diagnostics: result.diagnostics,
                },
              };
              this.service.store.insertAsset(asset);
              job.assetIds.push(id);
              job.diagnostics.push(result.diagnostics);
            }
            const current =
              this.service.store.playground(job.projectId)[job.projectId] ?? [];
            this.service.store.setProjectPlayground(job.projectId, [
              ...current,
              ...job.assetIds,
            ]);
            job.status = "completed";
            job.progress = 1;
          } finally {
            await worker.terminate();
            this.running = undefined;
            finish();
          }
        } catch (error) {
          job.error = error instanceof Error ? error.message : String(error);
          job.status = /cancel|closing|closed/i.test(job.error)
            ? "cancelled"
            : "failed";
        } finally {
          this.cancelled.delete(job.id);
          for (const path of paths) await unlink(path).catch(() => {});
          if (
            this.db
              .prepare("SELECT id FROM projects WHERE id=?")
              .get(job.projectId)
          )
            this.saveJob(job);
        }
      }
    } finally {
      this.pumping = false;
    }
  }
  private async export(
    projectId: string,
    id: string,
    revision: number,
    destination: string,
    format: "package" | "midi",
  ) {
    if (!isAbsolute(destination))
      throw new Error("Export destination must be absolute.");
    const record = this.get(projectId, id, revision);
    await mkdir(destination);
    const sources: { id: string; file: string; hash: string; asset: Asset }[] =
      [];
    if (format === "package") {
      for (const sourceId of sourceIds(record.document)) {
        const asset = this.service.store.asset(sourceId, projectId),
          source = this.service.media.path(asset);
        if ((await fileHash(source)) !== asset.hash)
          throw new Error("Source integrity failed.");
        const file = `${sourceId}.${asset.format}`;
        await copyFile(source, join(destination, file));
        sources.push({ id: sourceId, file, hash: asset.hash, asset });
      }
      const bank = record.document.soundfontHash;
      if (bank) {
        if (await fileHash(this.bankPath(bank)) !== bank) throw new Error('Pinned SoundFont integrity failed.');
        await copyFile(this.bankPath(bank), join(destination, 'soundfont.sf2'));
        if (bank === '9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe') await writeFile(join(destination, 'GeneralUser-GS-LICENSE.txt'), generalUserLicense, { flag: 'wx' });
        await writeFile(join(destination, 'soundfont-provenance.txt'), `SoundFont SHA-256: ${bank}\nThe exact bank used by this arrangement is included. Retain its original license before redistribution.\n`, { flag: 'wx' });
      }
      await writeFile(
        join(destination, "arrangement.json"),
        JSON.stringify(
          {
            version: 1,
            engine: ENGINE_VERSION,
            record,
            sources,
            soundfont: bank ? { file: 'soundfont.sf2', hash: bank } : null,
          },
          null,
          2,
        ) + "\n",
        { flag: "wx" },
      );
      return {
        destination,
        note: "Referenced audio and the pinned SoundFont are included with hashes. Keep source licensing/provenance with any redistribution.",
      };
    }
    const limitations = [
      'One Standard MIDI File per track, all starting at beat zero, with tempo/meter changes and section markers. Notes round to 480 ticks per quarter note.',
      'Expression, pedal, pan, volume, pitch bend, program and bank automation are exported; linear controllers are sampled at 24 points per beat. Gains above 1 are clamped. The initial drum bank selects channel 10; changing between melodic and percussion channel routing requires audio export.',
      'Synth patches, audio clips, effects, sends, mute/solo, and non-MIDI automation require arrangement/audio export. MIDI does not preserve the rendered timbre.'
    ];
    for (const [i, track] of record.document.tracks.entries()) {
      await writeFile(join(destination, `track-${i + 1}.mid`), writeArrangementMidi(record.document, track), { flag: 'wx' });
    }
    await writeFile(
      join(destination, "manifest.json"),
      JSON.stringify({ record, limitations }, null, 2) + "\n",
      { flag: "wx" },
    );
    return { destination, limitations };
  }
  private async import(
    projectId: string,
    source: string,
    origin: "user" | "agent",
  ) {
    if (!isAbsolute(source))
      throw new Error("Package folder must be absolute.");
    const root = resolve(source);
    if ((await stat(join(root, 'arrangement.json'))).size > 32 * 1024 * 1024) throw new Error('Package manifest exceeds 32 MiB.');
    const
      manifest = JSON.parse(
        await readFile(join(root, "arrangement.json"), "utf8"),
      );
    if (manifest.version !== 1 || !Array.isArray(manifest.sources))
      throw new Error("Unsupported arrangement package.");
    if (manifest.engine !== ENGINE_VERSION) throw new Error(`Package requires engine ${manifest.engine}; this app provides ${ENGINE_VERSION}. No automatic sound substitution was made.`);
    let doc = validateArrangement(manifest.record?.document);
    if (doc.soundfontHash) {
      if (manifest.soundfont?.hash !== doc.soundfontHash || manifest.soundfont?.file !== 'soundfont.sf2') throw new Error('Package SoundFont dependency is missing.');
      const path = join(root, 'soundfont.sf2');
      if ((await stat(path)).size > 256 * 1024 * 1024 || await fileHash(path) !== doc.soundfontHash) throw new Error('Invalid package SoundFont.');
      await mkdir(join(this.service.media.root, 'banks'), { recursive: true });
      await copyFile(path, this.bankPath(doc.soundfontHash));
    }
    const mapping = new Map<string, string>();
    if (manifest.sources.length > 2048 || new Set(manifest.sources.map((s: {id:string}) => s.id)).size !== manifest.sources.length) throw new Error('Invalid package source list.');
    for (const id of sourceIds(doc)) if (!manifest.sources.some((s: {id:string}) => s.id === id)) throw new Error(`Package source missing: ${id}`);
    for (const source of manifest.sources) {
      const path = resolve(root, source.file);
      if (
        !path.startsWith(root + sep) ||
        (await fileHash(path)) !== source.hash
      )
        throw new Error("Invalid package source or hash.");
    }
    for (const source of manifest.sources) {
      const asset = await this.service.media.import(
        join(root, source.file),
        projectId,
        "effect",
      );
      asset.name = typeof source.asset?.name === 'string' ? source.asset.name : asset.name;
      asset.description = `Imported arrangement dependency; original source ${source.id}, SHA-256 ${source.hash}. ${source.asset?.description ?? ''}`;
      asset.usage = JSON.stringify({ arrangementPackageSource: source.asset ?? { id: source.id, hash: source.hash } });
      this.service.store.project(projectId);
      this.service.store.insertAsset(asset);
      mapping.set(source.id, asset.id);
    }
    doc = structuredClone(doc);
    for (const t of doc.tracks) {
      if (t.instrument.sampleId)
        t.instrument.sampleId =
          mapping.get(t.instrument.sampleId) ?? t.instrument.sampleId;
      for (const p of t.instrument.pads)
        p.sampleId = mapping.get(p.sampleId) ?? p.sampleId;
      for (const c of t.clips)
        if (c.sampleId) c.sampleId = mapping.get(c.sampleId) ?? c.sampleId;
    }
    return this.save(projectId, doc, origin);
  }
}
