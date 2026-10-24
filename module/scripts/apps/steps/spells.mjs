/**
 * Spell gallery: card-based browsing, filtering, and selection within the class's limits.
 * Selection changes update the DOM in place so large spell lists stay responsive.
 */
import Step from "./base.mjs";
import { TEMPLATES } from "../../constants.mjs";
import { getDocument } from "../../data/compendium.mjs";
import { enrich } from "../../data/describe.mjs";
import { candidateSpells, castingClasses, existingSpells, spellSubtitle, spellTags } from "../../engine/spells.mjs";
import { escapeHTML, loc, t } from "../../utils.mjs";

export default class SpellsStep extends Step {
  static id = "spells";
  static template = TEMPLATES.spells;

  casterId = null;
  filter = { text: "", level: "all", school: "" };
  #candidates = new Map();
  #limits = null;
  #stage = null;

  get available() {
    if ( this.app.mode === "levelup" ) return !!this.app.levelup?.casting && this.state.levelup.applied;
    const actor = this.app.workingActor;
    if ( actor ) return castingClasses(actor).length > 0;
    return this.app.meta.isCaster;
  }

  get complete() {
    return this.app.mode === "levelup" ? true : this.app.buildCurrent;
  }

  get incompleteMessage() {
    return t("Spells.NeedFeatures");
  }

  get canGoBack() {
    return (this.app.mode !== "levelup") || !this.state.levelup.applied;
  }

  casters() {
    const actor = this.app.workingActor;
    if ( !actor ) return [];
    const list = castingClasses(actor);
    if ( this.app.mode === "levelup" ) return list.filter(c => c.identifier === this.state.levelup.identifier);
    return list;
  }

  picks(identifier) {
    this.state.spells[identifier] ??= { cantrips: [], spells: [], prepared: [], replace: [] };
    this.state.spells[identifier].replace ??= [];
    return this.state.spells[identifier];
  }

  async candidates(caster) {
    const key = `${this.state.buildKey ?? this.state.actorId}:${caster.identifier}:${caster.level}:${caster.spellList}`;
    if ( !this.#candidates.has(key) ) this.#candidates.set(key, candidateSpells(caster));
    return this.#candidates.get(key);
  }

  /** Spells already counted against the class (granted by features or known before a level-up). */
  existing(actor, caster) {
    const items = existingSpells(actor, caster.identifier).filter(i => i.system.prepared !== 2);
    return {
      cantrips: items.filter(i => i.system.level === 0).length,
      spells: items.filter(i => i.system.level > 0).length,
      identifiers: new Set(existingSpells(actor, caster.identifier).map(i => i.identifier ?? i.system.identifier)),
      items: existingSpells(actor, caster.identifier)
    };
  }

  async prepare() {
    const actor = this.app.workingActor;
    if ( !actor ) return { blocked: true, message: t("Spells.NeedFeatures") };
    const casters = this.casters();
    if ( !casters.length ) return { blocked: true, message: t("Spells.NoCasting") };
    const caster = casters.find(c => c.identifier === this.casterId) ?? casters[0];
    this.casterId = caster.identifier;

    const candidates = await this.candidates(caster);
    const picks = this.picks(caster.identifier);
    const existing = this.existing(actor, caster);
    const isSpellbook = caster.casting === "spellbook";

    // Level-up: classes that may swap spells on gaining a level (e.g. bard, sorcerer, warlock) can mark
    // known spells to forget; each one frees a slot for a new pick.
    const replaceMax = this.app.mode === "levelup" ? (caster.replacePerLevel ?? 0) : 0;
    const replaceable = new Set(existing.items.filter(i => (i.system.level > 0) && (i.system.prepared !== 2)).map(i => i.id));
    picks.replace = picks.replace.filter(id => replaceable.has(id)).slice(0, replaceMax);
    this.replaceMax = replaceMax;

    const limits = {
      cantrips: Math.max(0, caster.cantrips - existing.cantrips),
      spells: Math.max(0, (isSpellbook ? (caster.spellbook ?? caster.spells) : caster.spells) - existing.spells)
        + picks.replace.length,
      prepared: caster.spells
    };
    this.#limits = { ...limits, isSpellbook };

    // Drop picks that are no longer offered (e.g. after rebuilding at a lower level).
    const offered = new Set([...candidates.cantrips, ...candidates.leveled].map(s => s.uuid));
    picks.cantrips = picks.cantrips.filter(u => offered.has(u)).slice(0, limits.cantrips);
    picks.spells = picks.spells.filter(u => offered.has(u)).slice(0, limits.spells);
    picks.prepared = picks.prepared.filter(u => picks.spells.includes(u)).slice(0, limits.prepared);

    const card = entry => {
      const level = Number(entry.index.system?.level ?? 0);
      const owned = existing.identifiers.has(entry.identifier);
      return {
        uuid: entry.uuid,
        name: entry.name,
        img: entry.img,
        level,
        school: entry.index.system?.school ?? "",
        subtitle: spellSubtitle(entry),
        tags: spellTags(entry),
        owned,
        selected: !owned && (picks.cantrips.includes(entry.uuid) || picks.spells.includes(entry.uuid)),
        prepared: picks.prepared.includes(entry.uuid),
        search: entry.name.toLowerCase()
      };
    };

    const groups = new Map();
    for ( const entry of [...candidates.cantrips, ...candidates.leveled] ) {
      const c = card(entry);
      if ( !groups.has(c.level) ) groups.set(c.level, { level: c.level, label: loc(CONFIG.DND5E.spellLevels?.[c.level] ?? c.level), cards: [] });
      groups.get(c.level).cards.push(c);
    }
    const sortedGroups = Array.from(groups.values()).sort((a, b) => a.level - b.level);
    const schools = new Set([...candidates.cantrips, ...candidates.leveled].map(s => s.index.system?.school).filter(Boolean));

    return {
      casters: casters.map(c => ({ id: c.identifier, label: c.label, active: c === caster })),
      multiple: casters.length > 1,
      caster: {
        label: caster.label,
        level: caster.level,
        ability: caster.abilityLabel,
        casting: t(`Spells.Casting.${caster.casting}`),
        maxSpellLevel: caster.maxSpellLevel,
        countSource: t(`Spells.CountSource.${caster.countSource}`)
      },
      counters: this.#counters(picks, limits, isSpellbook, caster),
      isSpellbook,
      groups: sortedGroups,
      levels: sortedGroups.map(g => ({ level: g.level, label: g.label, active: String(g.level) === this.filter.level })),
      allLevels: this.filter.level === "all",
      schools: Array.from(schools).map(s => ({
        value: s, label: loc(CONFIG.DND5E.spellSchools?.[s]?.label ?? s), selected: s === this.filter.school
      })).sort((a, b) => a.label.localeCompare(b.label)),
      filter: this.filter,
      fromList: candidates.fromList,
      empty: !sortedGroups.length,
      granted: existing.items.map(i => ({
        id: i.id,
        name: i.name,
        img: i.img,
        always: i.system.prepared === 2,
        replaceable: (replaceMax > 0) && replaceable.has(i.id),
        marked: picks.replace.includes(i.id)
      })),
      replaceMax: replaceable.size ? replaceMax : 0
    };
  }

  #counters(picks, limits, isSpellbook, caster) {
    const counters = [];
    if ( limits.cantrips || picks.cantrips.length ) {
      counters.push({ key: "cantrips", label: t("Spells.Counter.cantrips"), used: picks.cantrips.length, max: limits.cantrips });
    }
    const spellLabel = isSpellbook ? "spellbook" : (caster.casting === "known" ? "known" : "prepared");
    counters.push({ key: "spells", label: t(`Spells.Counter.${spellLabel}`), used: picks.spells.length, max: limits.spells });
    if ( isSpellbook ) {
      counters.push({ key: "prepared", label: t("Spells.Counter.prepared"), used: picks.prepared.length, max: limits.prepared });
    }
    return counters.map(c => ({ ...c, full: c.used >= c.max, over: c.used > c.max }));
  }

  async validate() {
    if ( !this.#limits || !this.casterId ) return true;
    const remaining = [];
    for ( const caster of this.casters() ) {
      const picks = this.picks(caster.identifier);
      const limits = caster.identifier === this.casterId ? this.#limits : null;
      if ( !limits ) continue;
      const cantrips = limits.cantrips - picks.cantrips.length;
      const spells = limits.spells - picks.spells.length;
      if ( (cantrips > 0) || (spells > 0) ) remaining.push(t("Spells.Remaining", { name: caster.label, cantrips, spells }));
    }
    if ( !remaining.length ) return true;
    return foundry.applications.api.DialogV2.confirm({
      window: { title: t("Steps.spells") },
      content: `<p>${remaining.map(escapeHTML).join("<br>")}</p><p>${t("Spells.ContinueAnyway")}</p>`,
      rejectClose: false
    });
  }

  async onAction(action, event, target) {
    switch ( action ) {
      case "caster":
        this.casterId = target.dataset.caster;
        return this.app.refresh();
      case "toggleSpell":
        if ( target.classList.contains("owned") ) return;
        return this.toggle(target.dataset.uuid, Number(target.dataset.level));
      case "prepareSpell":
        return this.togglePrepared(target.dataset.uuid);
      case "inspectSpell":
        return this.inspect(target.dataset.uuid);
      case "spellLevel":
        this.filter.level = target.dataset.level;
        return this.#applyFilter();
      case "replaceSpell": {
        const picks = this.picks(this.casterId);
        const index = picks.replace.indexOf(target.dataset.id);
        if ( index >= 0 ) picks.replace.splice(index, 1);
        else if ( picks.replace.length >= (this.replaceMax ?? 0) ) {
          ui.notifications.warn(t("Spells.ReplaceLimit", { max: this.replaceMax ?? 0 }));
          return;
        } else picks.replace.push(target.dataset.id);
        return this.app.refresh();
      }
    }
  }

  toggle(uuid, level) {
    if ( !uuid || !this.#limits ) return;
    const picks = this.picks(this.casterId);
    const list = level === 0 ? picks.cantrips : picks.spells;
    const index = list.indexOf(uuid);
    if ( index >= 0 ) {
      list.splice(index, 1);
      picks.prepared = picks.prepared.filter(u => u !== uuid);
    } else {
      const max = level === 0 ? this.#limits.cantrips : this.#limits.spells;
      if ( list.length >= max ) {
        ui.notifications.warn(t(level === 0 ? "Spells.CantripLimit" : "Spells.SpellLimit", { max }));
        return;
      }
      list.push(uuid);
      // Spellbook casters: fill prepared slots automatically until they're full.
      if ( this.#limits.isSpellbook && (level > 0) && (picks.prepared.length < this.#limits.prepared) ) picks.prepared.push(uuid);
    }
    this.app.persist();
    this.#syncDOM();
    this.inspect(uuid);
  }

  togglePrepared(uuid) {
    const picks = this.picks(this.casterId);
    if ( !picks.spells.includes(uuid) ) return;
    const index = picks.prepared.indexOf(uuid);
    if ( index >= 0 ) picks.prepared.splice(index, 1);
    else if ( picks.prepared.length >= this.#limits.prepared ) {
      ui.notifications.warn(t("Spells.PreparedLimit", { max: this.#limits.prepared }));
      return;
    } else picks.prepared.push(uuid);
    this.app.persist();
    this.#syncDOM();
  }

  async inspect(uuid) {
    const panel = this.#stage?.querySelector(".spell-inspector");
    if ( !panel || !uuid ) return;
    panel.dataset.uuid = uuid;
    const doc = await getDocument(uuid);
    if ( !doc || (panel.dataset.uuid !== uuid) ) return;
    const labels = doc.labels ?? {};
    const rows = [
      [t("Spells.Inspector.Casting"), labels.activation],
      [t("Spells.Inspector.Range"), labels.range],
      [t("Spells.Inspector.Duration"), labels.duration],
      [t("Spells.Inspector.Components"), labels.components?.vsm ?? labels.components?.all?.map?.(c => c.abbr).join(", ")]
    ].filter(([, v]) => v);
    const description = await enrich(doc.system.description?.value ?? "", doc);
    if ( panel.dataset.uuid !== uuid ) return;
    panel.innerHTML = `
      <header>
        <img src="${escapeHTML(doc.img)}" alt="">
        <div><h3>${escapeHTML(doc.name)}</h3><span>${escapeHTML(spellSubtitle(doc))}</span></div>
      </header>
      <dl>${rows.map(([k, v]) => `<dt>${escapeHTML(k)}</dt><dd>${escapeHTML(v)}</dd>`).join("")}</dl>
      <div class="spell-description">${description}</div>`;
  }

  onKey(event) {
    const card = document.activeElement?.closest?.(".spell-card");
    if ( !card || !["Enter", " "].includes(event.key) || card.classList.contains("owned") ) return false;
    this.toggle(card.dataset.uuid, Number(card.dataset.level));
    return true;
  }

  onInput(event) {
    const el = event.target;
    if ( el.name === "spellSearch" ) {
      this.filter.text = el.value.trim().toLowerCase();
      this.#applyFilter();
    } else if ( el.name === "spellSchool" ) {
      this.filter.school = el.value;
      this.#applyFilter();
    }
  }

  activate(element) {
    this.#stage = element;
    this.#applyFilter();
    element.querySelectorAll(".spell-card").forEach(card => {
      card.addEventListener("mouseenter", () => this.inspect(card.dataset.uuid));
      card.addEventListener("focus", () => this.inspect(card.dataset.uuid));
    });
    const first = element.querySelector(".spell-card.selected") ?? element.querySelector(".spell-card");
    if ( first ) this.inspect(first.dataset.uuid);
  }

  #applyFilter() {
    const stage = this.#stage;
    if ( !stage ) return;
    const { text, level, school } = this.filter;
    stage.querySelectorAll(".spell-level-pill").forEach(p => p.classList.toggle("active", p.dataset.level === level));
    stage.querySelectorAll(".spell-group").forEach(group => {
      let visible = 0;
      const groupMatches = (level === "all") || (group.dataset.level === level);
      group.querySelectorAll(".spell-card").forEach(card => {
        const show = groupMatches && (!text || card.dataset.search.includes(text)) && (!school || (card.dataset.school === school));
        card.hidden = !show;
        if ( show ) visible++;
      });
      group.hidden = visible === 0;
    });
  }

  #syncDOM() {
    const stage = this.#stage;
    if ( !stage ) return;
    const picks = this.picks(this.casterId);
    const chosen = new Set([...picks.cantrips, ...picks.spells]);
    const prepared = new Set(picks.prepared);
    stage.querySelectorAll(".spell-card").forEach(card => {
      card.classList.toggle("selected", chosen.has(card.dataset.uuid));
      card.classList.toggle("prepared", prepared.has(card.dataset.uuid));
      card.setAttribute("aria-pressed", chosen.has(card.dataset.uuid));
    });
    const caster = this.casters().find(c => c.identifier === this.casterId);
    const counters = this.#counters(picks, this.#limits, this.#limits.isSpellbook, caster);
    for ( const c of counters ) {
      const el = stage.querySelector(`[data-counter="${c.key}"]`);
      if ( !el ) continue;
      el.querySelector(".used").textContent = c.used;
      el.classList.toggle("full", c.full);
    }
  }
}
