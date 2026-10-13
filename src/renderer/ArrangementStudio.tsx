import { useEffect, useRef, useState } from "react";
import {
  arrangementSchema,
  patternSchema,
  trackSchema,
  effectSchema,
  parameterRanges,
  instrumentParams,
  effectParams,
  starterPatches,
  instrumentSchema,
  sectionSchema,
  tempoSchema,
  busSchema,
  automationSchema,
  clipSchema,
  validateArrangement,
  beatSeconds,
  type Arrangement,
  type ArrangementRecord,
  type Track,
  type Effect,
  type Parameter,
} from "../shared/arrangement";
import {
  renderSchema,
  transformSchema,
} from "../shared/arrangement-operations";
import type { Snapshot } from "../shared/types";
import type { ArrangementJob } from "../main/arrangements";
import type { AuditionPlayer } from "./audition";
import { ArrangementPlayer } from "./arrangement-player";
import { workbench } from "./ReviewPanel";
import "./arrangement.css";

const uid = () => crypto.randomUUID();
function NumberField({
  label,
  value,
  onChange,
  step = 0.25,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = e.currentTarget.valueAsNumber;
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}
function Parameters({
  keys,
  values,
  change,
}: {
  keys: Parameter[];
  values: Record<string, number>;
  change(params: Record<string, number>): void;
}) {
  return (
    <div className="arr-parameters">
      {keys.map((key) => {
        const [min, max, fallback] = parameterRanges[key],
          value = values[key] ?? fallback;
        return (
          <label key={key}>
            {key}
            <span className="arr-parameter-value">
              <input
                aria-label={`${key} slider`}
                type="range"
                min={min}
                max={max}
                step={(max - min) / 1000}
                value={value}
                onChange={(e) => change({ ...values, [key]: +e.target.value })}
              />
              <input
                aria-label={key}
                type="number"
                min={min}
                max={max}
                step={(max - min) / 1000}
                value={Number(value.toFixed(4))}
                onChange={(e) => {
                  if (Number.isFinite(e.target.valueAsNumber))
                    change({ ...values, [key]: e.target.valueAsNumber });
                }}
              />
            </span>
          </label>
        );
      })}
    </div>
  );
}
function Effects({
  effects,
  tracks,
  change,
}: {
  effects: Effect[];
  tracks: Track[];
  change(effects: Effect[]): void;
}) {
  const [type, setType] = useState<Effect["type"]>("filter");
  return (
    <div className="arr-effects">
      {effects.map((fx, i) => (
        <details key={fx.id} open>
          <summary>
            {i + 1}. {fx.type} · {fx.id.slice(0, 8)}
          </summary>
          <div className="arr-row">
            <label>
              <input
                type="checkbox"
                checked={fx.bypass}
                onChange={(e) =>
                  change(
                    effects.map((x) =>
                      x.id === fx.id ? { ...x, bypass: e.target.checked } : x,
                    ),
                  )
                }
              />
              Bypass
            </label>
            <button
              disabled={i === 0}
              onClick={() => {
                const next = [...effects];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                change(next);
              }}
            >
              Move up
            </button>
            <button
              onClick={() => change(effects.filter((x) => x.id !== fx.id))}
            >
              Remove effect
            </button>
          </div>
          <Parameters
            keys={effectParams[fx.type]}
            values={fx.params}
            change={(params) =>
              change(
                effects.map((x) => (x.id === fx.id ? { ...x, params } : x)),
              )
            }
          />
          {fx.type === "compressor" && (
            <label>
              Sidechain
              <select
                value={fx.sidechain ?? ""}
                onChange={(e) =>
                  change(
                    effects.map((x) =>
                      x.id === fx.id
                        ? { ...x, sidechain: e.target.value || undefined }
                        : x,
                    ),
                  )
                }
              >
                <option value="">Own signal</option>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </details>
      ))}
      <div className="arr-row">
        <select
          aria-label="New effect type"
          value={type}
          onChange={(e) => setType(e.target.value as Effect["type"])}
        >
          {effectSchema.shape.type.options.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <button
          onClick={() =>
            change([...effects, effectSchema.parse({ id: uid(), type })])
          }
        >
          Add effect
        </button>
      </div>
    </div>
  );
}
export default function ArrangementStudio({
  snapshot,
  sessionId,
  audition,
}: {
  snapshot: Snapshot;
  sessionId: string | null;
  audition: AuditionPlayer;
}) {
  const projectId = snapshot.activeProjectId;
  const [list, setList] = useState<
      { id: string; name: string; revision: number }[]
    >([]),
    [record, setRecord] = useState<ArrangementRecord | null>(null),
    [draft, setDraft] = useState<Arrangement | null>(null);
  const [selectedTrack, selectTrack] = useState(""),
    [selectedPattern, selectPattern] = useState(""),
    [panel, setPanel] = useState("Arrange");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [sectionId, setSectionId] = useState("");
  const [jobs, setJobs] = useState<ArrangementJob[]>([]),
    [history, setHistory] = useState<Omit<ArrangementRecord, "document">[]>([]),
    [compare, setCompare] = useState<ArrangementRecord | null>(null);
  const [renderInput, setRenderInput] = useState(renderSchema.parse({})),
    [transform, setTransform] = useState(
      transformSchema.parse({ patternId: "", mode: "transpose", amount: 12 }),
    );
  const [path, setPath] = useState(""),
    [format, setFormat] = useState<"package" | "midi">("package"),
    [help, setHelp] = useState<Record<string, string>>({}),
    [topic, setTopic] = useState("music-craft.md"),
    [renderInfo, setRenderInfo] = useState<ArrangementJob | null>(null);
  const player = useRef<ArrangementPlayer | null>(null),
    undo = useRef<number[]>([]),
    redo = useRef<number[]>([]),
    current = useRef(record);
  current.current = record;
  if (!player.current)
    player.current = new ArrangementPlayer((state) => {
      setPlaying(state.playing);
      if (state.beat !== undefined) setPosition(state.beat);
      if (state.error) setError(state.error);
    });
  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError("");
    try {
      return await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    const [items, jobs] = await Promise.all([
      workbench<typeof list>("arrangement_list", { projectId }),
      workbench<ArrangementJob[]>("arrangement_jobs", { projectId }),
    ]);
    setList(items);
    setJobs(jobs);
  };
  const accept = (next: ArrangementRecord) => {
    setRecord(next);
    setDraft(structuredClone(next.document));
    selectTrack((id) =>
      next.document.tracks.some((t) => t.id === id)
        ? id
        : (next.document.tracks[0]?.id ?? ""),
    );
    selectPattern((id) =>
      next.document.patterns.some((t) => t.id === id)
        ? id
        : (next.document.patterns[0]?.id ?? ""),
    );
  };
  const load = (id: string) =>
    run(async () => {
      player.current!.stop();
      const next = await workbench<ArrangementRecord>("arrangement_get", {
          projectId,
          arrangementId: id,
        });
      accept(next);
      undo.current = Array.from({ length: next.revision - 1 }, (_, i) => i + 1);
      redo.current = [];
    });
  useEffect(() => {
    setRecord(null);
    setDraft(null);
    player.current!.stop();
    void run(refresh);
    const unsub = window.sfx.onChanged(() => {
      void refresh().catch((e) => setError(String(e)));
    });
    return () => {
      unsub();
      player.current!.stop();
    };
  }, [projectId]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) player.current!.stop();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  useEffect(
    () =>
      audition.subscribe(() => {
        if (audition.getSnapshot().status === "playing") player.current!.stop();
      }),
    [audition],
  );
  useEffect(() => {
    if (draft && playing) {
      try {
        player.current!.update(validateArrangement(draft));
      } catch {
        /* Uncommitted invalid fields do not enter the audio engine. */
      }
    }
  }, [draft, playing]);
  useEffect(() => {
    if (record)
      void workbench<typeof history>("arrangement_history", {
        projectId,
        arrangementId: record.id,
      })
        .then(setHistory)
        .catch((e) => setError(String(e)));
  }, [record]);
  const edit = (change: (doc: Arrangement) => void) =>
    setDraft((old) => {
      if (!old) return old;
      const next = structuredClone(old);
      change(next);
      return next;
    });
  const track = draft?.tracks.find((t) => t.id === selectedTrack),
    pattern = draft?.patterns.find((p) => p.id === selectedPattern);
  const save = async () => {
    if (!record || !draft) return;
    const parsed = validateArrangement(draft),
      old = record.document;
    const edits: unknown[] = [
      {
        type: "settings",
        values: {
          name: parsed.name,
          intent: parsed.intent,
          kind: parsed.kind,
          seed: parsed.seed,
          length: parsed.length,
          tempos: parsed.tempos,
          master: parsed.master,
        },
      },
    ];
    for (const [collection, type] of [
      ["tracks", "track"],
      ["patterns", "pattern"],
      ["sections", "section"],
      ["buses", "bus"],
    ] as const) {
      for (const entry of parsed[collection])
        if (
          JSON.stringify(entry) !==
          JSON.stringify(old[collection].find((x) => x.id === entry.id))
        )
          edits.push({ type, value: entry });
      for (const entry of old[collection])
        if (!parsed[collection].some((x) => x.id === entry.id))
          edits.push({ type: "remove", collection, id: entry.id });
    }
    const next = await workbench<ArrangementRecord>("arrangement_edit", {
      projectId,
      arrangementId: record.id,
      expectedRevision: record.revision,
      edits,
    });
    accept(next);
    undo.current.push(record.revision);
    redo.current = [];
    return next;
  };
  const dirty =
    !!record && JSON.stringify(draft) !== JSON.stringify(record.document);
  const updateTrack = (change: (track: Track) => void) =>
    edit((d) => {
      const t = d.tracks.find((t) => t.id === selectedTrack);
      if (t) change(t);
    });
  const create = () =>
    run(async () => {
      const next = await workbench<ArrangementRecord>("arrangement_create", {
        projectId,
        document: { name: "Untitled arrangement" },
      });
      accept(next);
    });
  const restore = (revision: number, mode: 'restore' | 'undo' | 'redo' = 'restore') =>
    run(async () => {
      if (!record) return;
      player.current!.stop();
      accept(
        await workbench<ArrangementRecord>("arrangement_restore", {
          projectId,
          arrangementId: record.id,
          expectedRevision: record.revision,
          sourceRevision: revision,
        }),
      );
      if (mode === 'undo') { undo.current.pop(); redo.current.push(record.revision); }
      else if (mode === 'redo') { redo.current.pop(); undo.current.push(record.revision); }
      else { undo.current.push(record.revision); redo.current = []; }
    });
  return (
    <section className="arr-studio">
      <header className="arr-toolbar">
        <select
          aria-label="Arrangement"
          value={record?.id ?? ""}
          onChange={(e) => void load(e.target.value)}
        >
          <option value="">Choose arrangement</option>
          {list.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · r{r.revision}
            </option>
          ))}
        </select>
        <button onClick={create} disabled={busy}>
          New arrangement
        </button>
        <select
          aria-label="Open MIDI in workstation"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value)
              void run(async () =>
                accept(
                  await workbench<ArrangementRecord>("arrangement_from_midi", {
                    projectId,
                    assetId: e.target.value,
                  }),
                ),
              );
            e.target.value = "";
          }}
        >
          <option value="">Open MIDI…</option>
          {snapshot.assets
            .filter((a) => a.format === "mid")
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
        {record && (
          <>
            <button
              className="primary-button"
              disabled={!dirty || busy}
              onClick={() => void run(save)}
            >
              Save changes
            </button>
            <button
              disabled={!undo.current.length || dirty || busy}
              onClick={() => {
                void restore(undo.current.at(-1)!, 'undo');
              }}
            >
              Undo
            </button>
            <button
              disabled={!redo.current.length || dirty || busy}
              onClick={() => {
                const rev = redo.current.at(-1);
                if (rev) void restore(rev, 'redo');
              }}
            >
              Redo
            </button>
            <span>
              {dirty ? "Unsaved changes" : `Revision ${record.revision}`}
            </span>
            <button onClick={() => void load(record.id)}>Reload</button>
          </>
        )}
      </header>
      {error && (
        <div role="alert" className="arr-error">
          {error}
        </div>
      )}
      {!draft ? (
        <div className="arr-empty">
          <h2>Local workstation</h2>
          <p>
            Build an editable arrangement of notes, instruments, samples, and
            effects. Create one here or ask the assistant.
          </p>
          <label>
            Reopen arrangement package
            <input
              placeholder="Absolute folder path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
          </label>
          <button
            disabled={!path || busy}
            onClick={() =>
              void run(async () =>
                accept(
                  await workbench<ArrangementRecord>("arrangement_import", {
                    projectId,
                    source: path,
                  }),
                ),
              )
            }
          >
            Open package
          </button>
        </div>
      ) : (
        <>
          <div className="arr-transport">
            <button
              disabled={busy || !draft.tracks.length}
              onClick={() => {
                if (playing) player.current!.stop();
                else {
                  audition.stop();
                  const section = draft.sections.find(
                    (s) => s.id === sectionId,
                  );
                  void run(() =>
                    player.current!.play(
                      validateArrangement(draft),
                      section?.start ?? position,
                      section ? section.start + section.length : undefined,
                    ),
                  );
                }
              }}
            >
              {playing ? "Stop" : "Play"}
            </button>
            <button
              onClick={() => {
                player.current!.stop();
                setPosition(0);
              }}
            >
              Rewind
            </button>
            <NumberField
              label="Seek beat"
              value={Number(position.toFixed(2))}
              onChange={(v) => {
                player.current!.stop();
                setPosition(v);
              }}
              min={0}
              max={draft.length}
            />
            <span>{beatSeconds(draft, draft.length).toFixed(1)} seconds</span>
            <select
              aria-label="Playback section"
              value={sectionId}
              onChange={(e) => {
                player.current!.stop();
                setSectionId(e.target.value);
              }}
            >
              <option value="">Whole arrangement</option>
              {draft.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <nav className="arr-tabs">
            {[
              "Arrange",
              "Notes",
              "Instrument",
              "Mix",
              "Automation",
              "Render & export",
              "History",
              "Guide",
            ].map((p) => (
              <button
                key={p}
                className={panel === p ? "active" : ""}
                onClick={() => setPanel(p)}
              >
                {p}
              </button>
            ))}
          </nav>
          <div className="arr-body">
            <aside className="arr-tracks">
              <h3>Tracks</h3>
              {draft.tracks.map((t) => (
                <button
                  key={t.id}
                  className={t.id === selectedTrack ? "active" : ""}
                  onClick={() => selectTrack(t.id)}
                >
                  <strong>{t.name}</strong>
                  <small>{t.role || t.instrument.type}</small>
                </button>
              ))}
              <button
                onClick={() => {
                  const t = trackSchema.parse({
                    id: uid(),
                    name: `Track ${draft.tracks.length + 1}`,
                    instrument: starterPatches[0].instrument,
                  });
                  edit((d) => d.tracks.push(t));
                  selectTrack(t.id);
                }}
              >
                Add track
              </button>
              {track && (
                <button
                  onClick={() => {
                    player.current!.stop();
                    edit((d) => {
                      d.tracks = d.tracks.filter((t) => t.id !== selectedTrack);
                    });
                    selectTrack("");
                  }}
                >
                  Remove track
                </button>
              )}
            </aside>
            <main className="arr-panel">
              {panel === "Arrange" && (
                <>
                  <div className="arr-row">
                    <label>
                      Name
                      <input
                        value={draft.name}
                        onChange={(e) =>
                          edit((d) => {
                            d.name = e.target.value;
                          })
                        }
                      />
                    </label>
                    <NumberField
                      label="Length (beats)"
                      value={draft.length}
                      onChange={(v) =>
                        edit((d) => {
                          d.length = v;
                        })
                      }
                    />
                    <NumberField
                      label="Variation seed"
                      value={draft.seed}
                      step={1}
                      onChange={(v) =>
                        edit((d) => {
                          d.seed = v;
                        })
                      }
                    />
                    <label>
                      Type
                      <select
                        value={draft.kind}
                        onChange={(e) =>
                          edit((d) => {
                            d.kind = e.target.value as Arrangement["kind"];
                          })
                        }
                      >
                        <option value="music">Music</option>
                        <option value="effect">Sound effect</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Creative intent
                    <textarea
                      value={draft.intent}
                      onChange={(e) =>
                        edit((d) => {
                          d.intent = e.target.value;
                        })
                      }
                    />
                  </label>
                  <div
                    className="arr-timeline"
                    aria-label="Arrangement timeline"
                  >
                    {draft.tracks.map((t) => (
                      <div key={t.id} className="arr-lane">
                        <span>{t.name}</span>
                        <div className="arr-lane-clips">
                          {t.clips.map((c) => (
                            <button
                              key={c.id}
                              style={{
                                left: `${(c.start / draft.length) * 100}%`,
                                width: `${(c.length / draft.length) * 100}%`,
                              }}
                              onClick={() => {
                                selectTrack(t.id);
                                if (c.patternId) selectPattern(c.patternId);
                              }}
                              title={`${c.name}: beat ${c.start}, length ${c.length}`}
                            >
                              {c.name}
                            </button>
                          ))}
                          <i
                            style={{
                              left: `${(position / draft.length) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <h3>Tempo and meter</h3>
                  {draft.tempos.map((t, i) => (
                    <div className="arr-row" key={i}>
                      <NumberField
                        label={`Tempo ${i + 1} beat`}
                        value={t.beat}
                        onChange={(v) =>
                          edit((d) => {
                            d.tempos[i].beat = v;
                          })
                        }
                      />
                      <NumberField
                        label={`Tempo ${i + 1} BPM`}
                        value={t.bpm}
                        step={1}
                        onChange={(v) =>
                          edit((d) => {
                            d.tempos[i].bpm = v;
                          })
                        }
                      />
                      <NumberField
                        label={`Meter ${i + 1} numerator`}
                        value={t.numerator}
                        step={1}
                        onChange={(v) =>
                          edit((d) => {
                            d.tempos[i].numerator = v;
                          })
                        }
                      />
                      <select
                        aria-label={`Meter ${i + 1} denominator`}
                        value={t.denominator}
                        onChange={(e) =>
                          edit((d) => {
                            d.tempos[i].denominator = +e.target.value as
                              | 1
                              | 2
                              | 4
                              | 8
                              | 16;
                          })
                        }
                      >
                        {[1, 2, 4, 8, 16].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                      {i > 0 && (
                        <button
                          onClick={() =>
                            edit((d) => {
                              d.tempos.splice(i, 1);
                            })
                          }
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      edit((d) =>
                        d.tempos.push(
                          tempoSchema.parse({
                            beat: Math.min(d.length, d.tempos.at(-1)!.beat + 4),
                            bpm: 120,
                          }),
                        ),
                      )
                    }
                  >
                    Add tempo change
                  </button>
                  <h3>Sections</h3>
                  {draft.sections.map((s, i) => (
                    <div className="arr-section" key={s.id}>
                      <div className="arr-row">
                        <input
                          aria-label={`Section ${i + 1} name`}
                          value={s.name}
                          onChange={(e) =>
                            edit((d) => {
                              d.sections[i].name = e.target.value;
                            })
                          }
                        />
                        <NumberField
                          label="Section start"
                          value={s.start}
                          onChange={(v) =>
                            edit((d) => {
                              d.sections[i].start = v;
                            })
                          }
                        />
                        <NumberField
                          label="Section length"
                          value={s.length}
                          onChange={(v) =>
                            edit((d) => {
                              d.sections[i].length = v;
                            })
                          }
                        />
                        <button
                          onClick={() =>
                            edit((d) => {
                              d.sections.splice(i, 1);
                            })
                          }
                        >
                          Remove
                        </button>
                      </div>
                      <input
                        aria-label="Section intent"
                        placeholder="What changes here?"
                        value={s.intent}
                        onChange={(e) =>
                          edit((d) => {
                            d.sections[i].intent = e.target.value;
                          })
                        }
                      />
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      edit((d) =>
                        d.sections.push(
                          sectionSchema.parse({
                            id: uid(),
                            name: "New section",
                            start: 0,
                            length: Math.min(16, d.length),
                          }),
                        ),
                      )
                    }
                  >
                    Add section
                  </button>
                  {track && (
                    <>
                      <h3>{track.name}: clips</h3>
                      <div className="arr-row">
                        <label>
                          Track name
                          <input
                            value={track.name}
                            onChange={(e) =>
                              updateTrack((t) => {
                                t.name = e.target.value;
                              })
                            }
                          />
                        </label>
                        <label>
                          Musical role
                          <input
                            value={track.role}
                            onChange={(e) =>
                              updateTrack((t) => {
                                t.role = e.target.value;
                              })
                            }
                          />
                        </label>
                      </div>
                      {track.clips.map((c, i) => (
                        <details key={c.id} open>
                          <summary>{c.name}</summary>
                          <div className="arr-row">
                            <input
                              aria-label="Clip name"
                              value={c.name}
                              onChange={(e) =>
                                updateTrack((t) => {
                                  t.clips[i].name = e.target.value;
                                })
                              }
                            />
                            <NumberField
                              label="Clip start"
                              value={c.start}
                              onChange={(v) =>
                                updateTrack((t) => {
                                  t.clips[i].start = v;
                                })
                              }
                            />
                            <NumberField
                              label="Clip length"
                              value={c.length}
                              onChange={(v) =>
                                updateTrack((t) => {
                                  t.clips[i].length = v;
                                })
                              }
                            />
                            <NumberField
                              label={
                                c.sampleId ? "Offset seconds" : "Offset beats"
                              }
                              value={c.offset}
                              onChange={(v) =>
                                updateTrack((t) => {
                                  t.clips[i].offset = v;
                                })
                              }
                            />
                            <NumberField
                              label="Transpose"
                              value={c.transpose}
                              step={1}
                              onChange={(v) =>
                                updateTrack((t) => {
                                  t.clips[i].transpose = v;
                                })
                              }
                            />
                            <NumberField
                              label="Clip gain"
                              value={c.gain}
                              step={0.05}
                              onChange={(v) =>
                                updateTrack((t) => {
                                  t.clips[i].gain = v;
                                })
                              }
                            />
                          </div>
                          <label>
                            Source
                            <select
                              value={c.patternId ?? c.sampleId}
                              onChange={(e) =>
                                updateTrack((t) => {
                                  const isPattern = draft.patterns.some(
                                    (p) => p.id === e.target.value,
                                  );
                                  t.clips[i].patternId = isPattern
                                    ? e.target.value
                                    : undefined;
                                  t.clips[i].sampleId = isPattern
                                    ? undefined
                                    : e.target.value;
                                })
                              }
                            >
                              <optgroup label="Patterns">
                                {draft.patterns.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </optgroup>
                              <optgroup label="Audio">
                                {snapshot.assets
                                  .filter((a) => a.format !== "mid")
                                  .map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.name}
                                    </option>
                                  ))}
                              </optgroup>
                            </select>
                          </label>
                          <div className="arr-row">
                            <label>
                              <input
                                type="checkbox"
                                checked={c.repeat}
                                onChange={(e) =>
                                  updateTrack((t) => {
                                    t.clips[i].repeat = e.target.checked;
                                  })
                                }
                              />
                              Repeat pattern
                            </label>
                            <label>
                              <input
                                type="checkbox"
                                checked={c.reverse}
                                onChange={(e) =>
                                  updateTrack((t) => {
                                    t.clips[i].reverse = e.target.checked;
                                  })
                                }
                              />
                              Reverse sample
                            </label>
                            <button
                              onClick={() =>
                                updateTrack((t) => {
                                  t.clips.splice(i, 1);
                                })
                              }
                            >
                              Remove clip
                            </button>
                          </div>
                        </details>
                      ))}
                      <button
                        disabled={
                          !draft.patterns.length &&
                          !snapshot.assets.some((a) => a.format !== "mid")
                        }
                        onClick={() =>
                          updateTrack((t) =>
                            t.clips.push(
                              clipSchema.parse({
                                id: uid(),
                                name: "New clip",
                                start: 0,
                                length: Math.min(4, draft.length),
                                ...(draft.patterns[0]
                                  ? { patternId: draft.patterns[0].id }
                                  : {
                                      sampleId: snapshot.assets.find(
                                        (a) => a.format !== "mid",
                                      )!.id,
                                    }),
                              }),
                            ),
                          )
                        }
                      >
                        Add clip
                      </button>
                    </>
                  )}
                </>
              )}
              {panel === "Notes" && (
                <>
                  <div className="arr-row">
                    <select
                      aria-label="Pattern"
                      value={selectedPattern}
                      onChange={(e) => selectPattern(e.target.value)}
                    >
                      <option value="">Choose pattern</option>
                      {draft.patterns.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        const p = patternSchema.parse({
                          id: uid(),
                          name: "New pattern",
                          length: 4,
                          notes: [],
                        });
                        edit((d) => d.patterns.push(p));
                        selectPattern(p.id);
                      }}
                    >
                      New pattern
                    </button>
                    {pattern && (
                      <button
                        onClick={() =>
                          edit((d) => {
                            d.patterns = d.patterns.filter(
                              (p) => p.id !== pattern.id,
                            );
                          })
                        }
                      >
                        Remove pattern
                      </button>
                    )}
                  </div>
                  {pattern && (
                    <>
                      <div className="arr-row">
                        <label>
                          Pattern name
                          <input
                            value={pattern.name}
                            onChange={(e) =>
                              edit((d) => {
                                d.patterns.find(
                                  (p) => p.id === pattern.id,
                                )!.name = e.target.value;
                              })
                            }
                          />
                        </label>
                        <NumberField
                          label="Pattern length"
                          value={pattern.length}
                          onChange={(v) =>
                            edit((d) => {
                              d.patterns.find(
                                (p) => p.id === pattern.id,
                              )!.length = v;
                            })
                          }
                        />
                        <label>
                          Motif / intent
                          <input
                            value={pattern.intent}
                            onChange={(e) =>
                              edit((d) => {
                                d.patterns.find(
                                  (p) => p.id === pattern.id,
                                )!.intent = e.target.value;
                              })
                            }
                          />
                        </label>
                      </div>
                      <div
                        className="arr-roll"
                        aria-label="Piano roll; click to add a note"
                        onClick={(e) => {
                          if (e.target !== e.currentTarget) return;
                          const bounds =
                              e.currentTarget.getBoundingClientRect(),
                            start =
                              Math.floor(
                                ((e.clientX - bounds.left) / bounds.width) *
                                  pattern.length *
                                  4,
                              ) / 4,
                            pitch = Math.max(
                              36,
                              Math.min(
                                84,
                                84 -
                                  Math.floor(
                                    ((e.clientY - bounds.top) / bounds.height) *
                                      49,
                                  ),
                              ),
                            );
                          edit((d) =>
                            d.patterns
                              .find((p) => p.id === pattern.id)!
                              .notes.push({
                                id: uid(),
                                pitch,
                                start,
                                duration: Math.min(
                                  0.25,
                                  pattern.length - start,
                                ),
                                velocity: 0.75,
                              }),
                          );
                        }}
                      >
                        {pattern.notes.map((n) => (
                          <button
                            key={n.id}
                            title={`Pitch ${n.pitch}, beat ${n.start}; click to remove`}
                            style={{
                              left: `${(n.start / pattern.length) * 100}%`,
                              width: `${(n.duration / pattern.length) * 100}%`,
                              top: `${((84 - n.pitch) / 49) * 100}%`,
                            }}
                            onClick={() =>
                              edit((d) => {
                                const p = d.patterns.find(
                                  (p) => p.id === pattern.id,
                                )!;
                                p.notes = p.notes.filter((x) => x.id !== n.id);
                              })
                            }
                          />
                        ))}
                      </div>
                      <details>
                        <summary>Drum step editor · 16 steps</summary>
                        {[36, 38, 42, 46].map((pitch) => (
                          <div className="arr-drum" key={pitch}>
                            <span>
                              {
                                (
                                  {
                                    36: "Kick",
                                    38: "Snare",
                                    42: "Closed hat",
                                    46: "Open hat",
                                  } as Record<number, string>
                                )[pitch]
                              }
                            </span>
                            {Array.from({ length: 16 }, (_, step) => {
                              const start = (step * pattern.length) / 16,
                                existing = pattern.notes.find(
                                  (n) =>
                                    n.pitch === pitch &&
                                    Math.abs(n.start - start) < 0.001,
                                );
                              return (
                                <button
                                  key={step}
                                  aria-label={`Drum ${pitch} step ${step + 1}`}
                                  aria-pressed={!!existing}
                                  onClick={() =>
                                    edit((d) => {
                                      const p = d.patterns.find(
                                        (p) => p.id === pattern.id,
                                      )!;
                                      if (existing)
                                        p.notes = p.notes.filter(
                                          (n) => n.id !== existing.id,
                                        );
                                      else
                                        p.notes.push({
                                          id: uid(),
                                          pitch,
                                          start,
                                          duration: Math.min(
                                            0.125,
                                            pattern.length / 16,
                                          ),
                                          velocity: 0.8,
                                        });
                                    })
                                  }
                                >
                                  {step + 1}
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </details>
                      <details>
                        <summary>
                          Exact note editing ({pattern.notes.length} notes)
                        </summary>
                        <div className="arr-note-table">
                          {pattern.notes.map((n, i) => (
                            <div className="arr-row" key={n.id}>
                              {(
                                [
                                  "pitch",
                                  "start",
                                  "duration",
                                  "velocity",
                                ] as const
                              ).map((key) => (
                                <NumberField
                                  key={key}
                                  label={`Note ${i + 1} ${key}`}
                                  value={n[key]}
                                  step={key === "pitch" ? 1 : 0.01}
                                  onChange={(v) =>
                                    edit((d) => {
                                      d.patterns.find(
                                        (p) => p.id === pattern.id,
                                      )!.notes[i][key] = v;
                                    })
                                  }
                                />
                              ))}
                              <button
                                onClick={() =>
                                  edit((d) => {
                                    d.patterns
                                      .find((p) => p.id === pattern.id)!
                                      .notes.splice(i, 1);
                                  })
                                }
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      </details>
                      <button
                        onClick={() =>
                          edit((d) =>
                            d.patterns
                              .find((p) => p.id === pattern.id)!
                              .notes.push({
                                id: uid(),
                                pitch: 60,
                                start: 0,
                                duration: 0.25,
                                velocity: 0.75,
                              }),
                          )
                        }
                      >
                        Add note
                      </button>
                      <h3>Transform pattern</h3>
                      <div className="arr-row">
                        <select
                          aria-label="Transformation"
                          value={transform.mode}
                          onChange={(e) =>
                            setTransform({
                              ...transform,
                              mode: e.target.value as typeof transform.mode,
                            })
                          }
                        >
                          {transformSchema.shape.mode.options.map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                        <NumberField
                          label="Amount"
                          value={transform.amount}
                          onChange={(v) =>
                            setTransform({ ...transform, amount: v })
                          }
                        />
                        <NumberField
                          label="Grid beats"
                          value={transform.grid}
                          onChange={(v) =>
                            setTransform({ ...transform, grid: v })
                          }
                        />
                        <NumberField
                          label="Repeats"
                          value={transform.repeats}
                          step={1}
                          onChange={(v) =>
                            setTransform({ ...transform, repeats: v })
                          }
                        />
                        <NumberField
                          label="Transform seed"
                          value={transform.seed}
                          step={1}
                          onChange={(v) =>
                            setTransform({ ...transform, seed: v })
                          }
                        />
                        <button
                          disabled={dirty || busy}
                          onClick={() =>
                            void run(async () =>
                              accept(
                                await workbench<ArrangementRecord>(
                                  "arrangement_transform",
                                  {
                                    projectId,
                                    arrangementId: record!.id,
                                    expectedRevision: record!.revision,
                                    input: {
                                      ...transform,
                                      patternId: pattern.id,
                                    },
                                  },
                                ),
                              ),
                            )
                          }
                        >
                          Apply to saved pattern
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
              {panel === "Instrument" &&
                (track ? (
                  <>
                    <h3>{track.name}</h3>
                    <div className="arr-row">
                      <label>
                        Instrument
                        <select
                          value={track.instrument.type}
                          onChange={(e) => {
                            player.current!.stop();
                            updateTrack((t) => {
                              t.instrument = instrumentSchema.parse({
                                type: e.target.value,
                              });
                            });
                          }}
                        >
                          {instrumentSchema.shape.type.options.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      </label>
                      <select
                        aria-label="Starter patch"
                        defaultValue=""
                        onChange={(e) => {
                          const patch = starterPatches[+e.target.value];
                          if (patch) {
                            player.current!.stop();
                            updateTrack((t) => {
                              t.instrument = structuredClone(patch.instrument);
                            });
                          }
                          e.target.value = "";
                        }}
                      >
                        <option value="">Load starter patch…</option>
                        {starterPatches.map((p, i) => (
                          <option value={i} key={p.name}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {track.instrument.type === "subtractive" && (
                        <label>
                          Waveform
                          <select
                            value={track.instrument.waveform}
                            onChange={(e) =>
                              updateTrack((t) => {
                                t.instrument.waveform = e.target
                                  .value as typeof t.instrument.waveform;
                              })
                            }
                          >
                            {["sine", "triangle", "saw", "square"].map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    <Parameters
                      keys={instrumentParams[track.instrument.type]}
                      values={track.instrument.params}
                      change={(params) =>
                        updateTrack((t) => {
                          t.instrument.params = params;
                        })
                      }
                    />
                    {["sampler", "granular"].includes(
                      track.instrument.type,
                    ) && (
                      <>
                        <label>
                          Sample
                          <select
                            value={track.instrument.sampleId ?? ""}
                            onChange={(e) => {
                              player.current!.stop();
                              updateTrack((t) => {
                                t.instrument.sampleId =
                                  e.target.value || undefined;
                              });
                            }}
                          >
                            <option value="">Choose source</option>
                            {snapshot.assets
                              .filter((a) => a.format !== "mid")
                              .map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <button
                          disabled={!sessionId}
                          onClick={() =>
                            void window.sfx.importAudio(sessionId!, "effect")
                          }
                        >
                          Import audio source
                        </button>
                        <h3>Drum pad mapping</h3>
                        {track.instrument.pads.map((pad, i) => (
                          <div key={i} className="arr-row">
                            <NumberField
                              label="Pad note"
                              value={pad.pitch}
                              step={1}
                              onChange={(v) =>
                                updateTrack((t) => {
                                  t.instrument.pads[i].pitch = v;
                                })
                              }
                            />
                            <NumberField
                              label="Pad root pitch"
                              value={pad.rootPitch}
                              step={1}
                              onChange={(v) =>
                                updateTrack((t) => {
                                  t.instrument.pads[i].rootPitch = v;
                                })
                              }
                            />
                            <select
                              aria-label="Pad source"
                              value={pad.sampleId}
                              onChange={(e) =>
                                updateTrack((t) => {
                                  t.instrument.pads[i].sampleId =
                                    e.target.value;
                                })
                              }
                            >
                              {snapshot.assets
                                .filter((a) => a.format !== "mid")
                                .map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}
                                  </option>
                                ))}
                            </select>
                            <button
                              onClick={() =>
                                updateTrack((t) => {
                                  t.instrument.pads.splice(i, 1);
                                })
                              }
                            >
                              Remove pad
                            </button>
                          </div>
                        ))}
                        <button
                          disabled={
                            !snapshot.assets.some((a) => a.format !== "mid")
                          }
                          onClick={() =>
                            updateTrack((t) =>
                              t.instrument.pads.push({
                                pitch: 36 + t.instrument.pads.length,
                                rootPitch: 60,
                                sampleId: snapshot.assets.find(
                                  (a) => a.format !== "mid",
                                )!.id,
                              }),
                            )
                          }
                        >
                          Add pad
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <p>Select a track.</p>
                ))}
              {panel === "Mix" && (
                <>
                  <div className="arr-mixer">
                    {draft.tracks.map((t, i) => (
                      <div key={t.id}>
                        <strong>{t.name}</strong>
                        <Parameters
                          keys={["gain", "pan"]}
                          values={{ gain: t.gain, pan: t.pan }}
                          change={(p) =>
                            edit((d) => {
                              d.tracks[i].gain = p.gain;
                              d.tracks[i].pan = p.pan;
                            })
                          }
                        />
                        <label>
                          <input
                            type="checkbox"
                            checked={t.mute}
                            onChange={(e) =>
                              edit((d) => {
                                d.tracks[i].mute = e.target.checked;
                              })
                            }
                          />
                          Mute
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={t.solo}
                            onChange={(e) =>
                              edit((d) => {
                                d.tracks[i].solo = e.target.checked;
                              })
                            }
                          />
                          Solo
                        </label>
                      </div>
                    ))}
                  </div>
                  {track && (
                    <>
                      <h3>{track.name}: inserts</h3>
                      <Effects
                        effects={track.effects}
                        tracks={draft.tracks.filter((t) => t.id !== track.id)}
                        change={(effects) =>
                          updateTrack((t) => {
                            t.effects = effects;
                          })
                        }
                      />
                      <h3>Sends</h3>
                      {draft.buses.map((bus) => (
                        <NumberField
                          key={bus.id}
                          label={`Send to ${bus.name}`}
                          value={
                            track.sends.find((s) => s.busId === bus.id)?.gain ??
                            0
                          }
                          step={0.05}
                          min={0}
                          max={2}
                          onChange={(gain) =>
                            updateTrack((t) => {
                              t.sends = [
                                ...t.sends.filter((s) => s.busId !== bus.id),
                                { busId: bus.id, gain },
                              ];
                            })
                          }
                        />
                      ))}
                    </>
                  )}
                  <h3>Return buses</h3>
                  {draft.buses.map((bus, i) => (
                    <details key={bus.id}>
                      <summary>{bus.name}</summary>
                      <input
                        aria-label="Bus name"
                        value={bus.name}
                        onChange={(e) =>
                          edit((d) => {
                            d.buses[i].name = e.target.value;
                          })
                        }
                      />
                      <NumberField
                        label="Bus gain"
                        value={bus.gain}
                        onChange={(v) =>
                          edit((d) => {
                            d.buses[i].gain = v;
                          })
                        }
                      />
                      <Effects
                        effects={bus.effects}
                        tracks={draft.tracks}
                        change={(effects) =>
                          edit((d) => {
                            d.buses[i].effects = effects;
                          })
                        }
                      />
                      <button
                        onClick={() =>
                          edit((d) => {
                            d.buses.splice(i, 1);
                            d.tracks.forEach((t) => {
                              t.sends = t.sends.filter(
                                (s) => s.busId !== bus.id,
                              );
                            });
                          })
                        }
                      >
                        Remove bus
                      </button>
                    </details>
                  ))}
                  <button
                    onClick={() =>
                      edit((d) =>
                        d.buses.push(
                          busSchema.parse({ id: uid(), name: "Return" }),
                        ),
                      )
                    }
                  >
                    Add return bus
                  </button>
                  <h3>Master</h3>
                  <Effects
                    effects={draft.master}
                    tracks={draft.tracks}
                    change={(effects) =>
                      edit((d) => {
                        d.master = effects;
                      })
                    }
                  />
                </>
              )}
              {panel === "Automation" &&
                (track ? (
                  <>
                    <h3>{track.name}: automation</h3>
                    {track.automation.map((lane, i) => (
                      <details key={lane.id} open>
                        <summary>{lane.target}</summary>
                        <div className="arr-row">
                          <label>
                            Target
                            <select
                              value={lane.target}
                              onChange={(e) =>
                                updateTrack((t) => {
                                  t.automation[i].target = e.target.value;
                                })
                              }
                            >
                              {[
                                "gain",
                                "pan",
                                ...instrumentParams[track.instrument.type].map(
                                  (p) => `instrument.${p}`,
                                ),
                                ...track.effects.flatMap((f) =>
                                  effectParams[f.type].map(
                                    (p) => `effect.${f.id}.${p}`,
                                  ),
                                ),
                              ].map((p) => (
                                <option key={p}>{p}</option>
                              ))}
                            </select>
                          </label>
                          <select
                            aria-label="Automation interpolation"
                            value={lane.interpolation}
                            onChange={(e) =>
                              updateTrack((t) => {
                                t.automation[i].interpolation = e.target
                                  .value as "linear" | "step";
                              })
                            }
                          >
                            <option>linear</option>
                            <option>step</option>
                          </select>
                          <button
                            onClick={() =>
                              updateTrack((t) => {
                                t.automation.splice(i, 1);
                              })
                            }
                          >
                            Remove lane
                          </button>
                        </div>
                        <svg
                          className="arr-automation"
                          viewBox="0 0 600 100"
                          aria-label={`${lane.target} curve`}
                        >
                          <polyline
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            points={lane.points
                              .map((p) => {
                                const range =
                                  parameterRanges[
                                    lane.target.split(".").at(-1) as Parameter
                                  ];
                                return `${(p.beat / draft.length) * 600},${100 - ((p.value - range[0]) / (range[1] - range[0])) * 100}`;
                              })
                              .join(" ")}
                          />
                        </svg>
                        {lane.points.map((p, j) => (
                          <div className="arr-row" key={j}>
                            <NumberField
                              label={`Point ${j + 1} beat`}
                              value={p.beat}
                              onChange={(v) =>
                                updateTrack((t) => {
                                  t.automation[i].points[j].beat = v;
                                })
                              }
                            />
                            <NumberField
                              label={`Point ${j + 1} value`}
                              value={p.value}
                              step={0.01}
                              onChange={(v) =>
                                updateTrack((t) => {
                                  t.automation[i].points[j].value = v;
                                })
                              }
                            />
                            <button
                              disabled={lane.points.length < 2}
                              onClick={() =>
                                updateTrack((t) => {
                                  t.automation[i].points.splice(j, 1);
                                })
                              }
                            >
                              Remove point
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() =>
                            updateTrack((t) =>
                              t.automation[i].points.push({
                                beat: Math.min(
                                  draft.length,
                                  lane.points.at(-1)!.beat + 4,
                                ),
                                value: lane.points.at(-1)!.value,
                              }),
                            )
                          }
                        >
                          Add point
                        </button>
                      </details>
                    ))}
                    <button
                      onClick={() =>
                        updateTrack((t) =>
                          t.automation.push(
                            automationSchema.parse({
                              id: uid(),
                              target: "gain",
                              points: [{ beat: 0, value: t.gain }],
                            }),
                          ),
                        )
                      }
                    >
                      Add automation lane
                    </button>
                  </>
                ) : (
                  <p>Select a track.</p>
                ))}
              {panel === "Render & export" && (
                <>
                  <h3>Render saved revision</h3>
                  <div className="arr-row">
                    <label>Start beat override<input type="number" min={0} step={0.25} placeholder="Section start" value={renderInput.startBeat ?? ''} onChange={e => setRenderInput({ ...renderInput, startBeat: e.target.value === '' ? undefined : e.target.valueAsNumber })} /></label>
                    <label>End beat override<input type="number" min={0} step={0.25} placeholder="Section end" value={renderInput.endBeat ?? ''} onChange={e => setRenderInput({ ...renderInput, endBeat: e.target.value === '' ? undefined : e.target.valueAsNumber })} /></label>
                    <label>Render seed override<input type="number" min={1} step={1} placeholder="Arrangement seed" value={renderInput.seed ?? ''} onChange={e => setRenderInput({ ...renderInput, seed: e.target.value === '' ? undefined : e.target.valueAsNumber })} /></label>
                  </div>
                  <div className="arr-row">
                    <label>
                      Section
                      <select
                        value={renderInput.sectionId ?? ""}
                        onChange={(e) =>
                          setRenderInput({
                            ...renderInput,
                            sectionId: e.target.value || undefined,
                          })
                        }
                      >
                        <option value="">Whole arrangement</option>
                        {draft.sections.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Encoding
                      <select
                        value={renderInput.encoding}
                        onChange={(e) =>
                          setRenderInput({
                            ...renderInput,
                            encoding: e.target.value as "float32" | "pcm24",
                          })
                        }
                      >
                        <option value="float32">Float32 WAV</option>
                        <option value="pcm24">24-bit PCM WAV</option>
                      </select>
                    </label>
                    <NumberField
                      label="Tail seconds"
                      value={renderInput.tailSeconds}
                      onChange={(v) =>
                        setRenderInput({ ...renderInput, tailSeconds: v })
                      }
                    />
                    <NumberField
                      label="Variations"
                      value={renderInput.variations}
                      step={1}
                      onChange={(v) =>
                        setRenderInput({ ...renderInput, variations: v })
                      }
                    />
                    <NumberField
                      label="Seam taper ms"
                      value={renderInput.crossfadeMs}
                      onChange={(v) =>
                        setRenderInput({ ...renderInput, crossfadeMs: v })
                      }
                    />
                  </div>
                  <div className="arr-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={renderInput.stems}
                        onChange={(e) =>
                          setRenderInput({
                            ...renderInput,
                            stems: e.target.checked,
                          })
                        }
                      />
                      Mix plus aligned track/return stems
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={renderInput.loop}
                        onChange={(e) =>
                          setRenderInput({
                            ...renderInput,
                            loop: e.target.checked,
                          })
                        }
                      />
                      Exact-length loop
                    </label>
                  </div>
                  <button
                    className="primary-button"
                    disabled={dirty || busy || !sessionId}
                    onClick={() =>
                      void run(async () => {
                        await workbench("arrangement_render", {
                          projectId,
                          arrangementId: record!.id,
                          expectedRevision: record!.revision,
                          sessionId,
                          requestId: uid(),
                          input: renderInput,
                        });
                        await refresh();
                      })
                    }
                  >
                    Render audio
                  </button>
                  <p>
                    Stems exclude the master chain; return buses are separate
                    stems. Results appear in the library for WAV/Ogg export and
                    reviews.
                  </p>
                  <h3>Render jobs</h3>
                  {jobs.map((job) => (
                    <div className="arr-row" key={job.id}>
                      <span>
                        {job.status} · {Math.round(job.progress * 100)}% ·{" "}
                        {job.assetIds.length} outputs
                      </span>
                      <button
                        onClick={() =>
                          void run(async () =>
                            setRenderInfo(
                              await workbench<ArrangementJob>(
                                "arrangement_job",
                                { projectId, jobId: job.id },
                              ),
                            ),
                          )
                        }
                      >
                        Diagnostics
                      </button>
                      {["queued", "running"].includes(job.status) && (
                        <button
                          onClick={() =>
                            void run(async () => {
                              await workbench("arrangement_cancel", {
                                projectId,
                                jobId: job.id,
                              });
                              await refresh();
                            })
                          }
                        >
                          Cancel render
                        </button>
                      )}
                      {job.error && <span>{job.error}</span>}
                    </div>
                  ))}
                  {renderInfo && (
                    <pre>
                      {JSON.stringify(
                        {
                          status: renderInfo.status,
                          error: renderInfo.error,
                          diagnostics: renderInfo.diagnostics,
                          assetIds: renderInfo.assetIds,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  )}
                  <h3>Arrangement package / MIDI</h3>
                  <label>
                    Absolute folder path
                    <input
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                    />
                  </label>
                  <div className="arr-row">
                    <select
                      aria-label="Arrangement export format"
                      value={format}
                      onChange={(e) =>
                        setFormat(e.target.value as "package" | "midi")
                      }
                    >
                      <option value="package">Portable arrangement</option>
                      <option value="midi">MIDI tracks</option>
                    </select>
                    <button
                      disabled={!path || dirty || busy}
                      onClick={() =>
                        void run(async () => {
                          const result = await workbench("arrangement_export", {
                            projectId,
                            arrangementId: record!.id,
                            revision: record!.revision,
                            destination: path,
                            format,
                          });
                          setError(JSON.stringify(result));
                        })
                      }
                    >
                      Export to new folder
                    </button>
                    <button
                      disabled={!path || busy}
                      onClick={() =>
                        void run(async () =>
                          accept(
                            await workbench<ArrangementRecord>(
                              "arrangement_import",
                              { projectId, source: path },
                            ),
                          ),
                        )
                      }
                    >
                      Reopen package
                    </button>
                  </div>
                </>
              )}
              {panel === "History" && (
                <>
                  <h3>Saved revisions</h3>
                  {history.map((h) => (
                    <div className="arr-row" key={h.revision}>
                      <span>
                        Revision {h.revision} · {h.origin} ·{" "}
                        {new Date(h.updatedAt).toLocaleString()}
                      </span>
                      <button
                        onClick={() =>
                          void run(async () =>
                            setCompare(
                              await workbench<ArrangementRecord>(
                                "arrangement_get",
                                {
                                  projectId,
                                  arrangementId: record!.id,
                                  revision: h.revision,
                                },
                              ),
                            ),
                          )
                        }
                      >
                        Compare
                      </button>
                      <button
                        disabled={dirty || busy}
                        onClick={() => void restore(h.revision)}
                      >
                        Restore as new revision
                      </button>
                    </div>
                  ))}
                  {compare && (
                    <>
                      <h3>
                        Revision {compare.revision} compared with{" "}
                        {record!.revision}
                      </h3>
                      <p>
                        {compare.document.name} ·{" "}
                        {compare.document.tracks.length} tracks ·{" "}
                        {compare.document.patterns.length} patterns
                      </p>
                      {(
                        ["tracks", "patterns", "sections", "buses"] as const
                      ).map((key) => (
                        <p key={key}>
                          {key}:{" "}
                          {[
                            ...new Set([
                              ...compare.document[key].map((e) => e.id),
                              ...draft[key].map((e) => e.id),
                            ]),
                          ]
                            .filter(
                              (id) =>
                                JSON.stringify(
                                  compare.document[key].find(
                                    (e) => e.id === id,
                                  ),
                                ) !==
                                JSON.stringify(
                                  draft[key].find((e) => e.id === id),
                                ),
                            )
                            .map(
                              (id) =>
                                draft[key].find((e) => e.id === id)?.name ??
                                compare.document[key].find((e) => e.id === id)
                                  ?.name,
                            )
                            .join(", ") || "unchanged"}
                        </p>
                      ))}
                    </>
                  )}
                </>
              )}
              {panel === "Guide" && (
                <>
                  <h3>Composition and sound design</h3>
                  <button
                    onClick={() =>
                      void run(async () => {
                        const g = await workbench<{
                          documents: Record<string, string>;
                        }>("guidance", {});
                        setHelp(g.documents);
                      })
                    }
                  >
                    Load current guidance
                  </button>
                  <select
                    aria-label="Guidance topic"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                  >
                    {Object.keys(help).map((key) => (
                      <option key={key}>{key}</option>
                    ))}
                  </select>
                  <pre className="arr-guide">
                    {help[topic] ??
                      "Load the current guidance shared with the assistant and MCP agents."}
                  </pre>
                </>
              )}
            </main>
          </div>
        </>
      )}
    </section>
  );
}
