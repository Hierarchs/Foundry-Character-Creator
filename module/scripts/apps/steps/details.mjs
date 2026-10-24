/**
 * Name, portrait, token art, alignment, appearance, personality, and backstory.
 */
import Step from "./base.mjs";
import { DEFAULT_PORTRAIT, TEMPLATES } from "../../constants.mjs";
import { loc, t } from "../../utils.mjs";

const TEXT_FIELDS = ["name", "gender", "age", "height", "weight", "eyes", "hair", "skin", "faith",
  "appearance", "trait", "ideal", "bond", "flaw", "backstory", "img", "tokenImg", "alignment", "ownerId"];

export default class DetailsStep extends Step {
  static id = "details";
  static template = TEMPLATES.details;

  get available() {
    return this.app.mode === "create";
  }

  get complete() {
    return !!this.state.details.name?.trim();
  }

  get incompleteMessage() {
    return t("Details.Incomplete");
  }

  async prepare() {
    const d = this.state.details;
    const alignments = Object.values(CONFIG.DND5E.alignments ?? {}).map(label => loc(label));
    const fallback = this.app.docs.species?.img || this.app.docs.class?.img || DEFAULT_PORTRAIT;
    return {
      d,
      portrait: d.img || fallback,
      token: d.sameToken ? (d.img || fallback) : (d.tokenImg || d.img || fallback),
      hasPortrait: !!d.img,
      canBrowse: game.user.can("FILES_BROWSE"),
      alignments: alignments.map(a => ({ value: a, label: a, selected: d.alignment === a })),
      isGM: game.user.isGM,
      owners: game.users.filter(u => !u.isGM).map(u => ({ id: u.id, name: u.name, selected: d.ownerId === u.id })),
      subtitle: [this.app.docs.species?.name, this.app.docs.class?.name].filter(Boolean).join(" ")
    };
  }

  onInput(event) {
    const el = event.target;
    const d = this.state.details;
    if ( el.name === "sameToken" ) {
      d.sameToken = el.checked;
      return this.app.refresh();
    }
    if ( !TEXT_FIELDS.includes(el.name) ) return;
    d[el.name] = el.value;
    this.app.persist();
    // Name and art affect what's shown elsewhere; text fields don't need a re-render.
    if ( (el.name === "name") && (event.type === "change") ) this.app.render({ parts: ["chrome"] });
    if ( ["img", "tokenImg"].includes(el.name) && (event.type === "change") ) this.app.refresh();
  }

  async onAction(action, event, target) {
    if ( action !== "pickImage" ) return;
    const field = target.dataset.field;
    const FilePicker = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    const picker = new FilePicker({
      type: "image",
      current: this.state.details[field] || "",
      callback: path => {
        this.state.details[field] = path;
        this.app.refresh();
      }
    });
    return picker.browse?.() ?? picker.render(true);
  }
}
