
import { HTML } from "imperative-html/dist/esm/elements-strict";
import { Prompt } from "./Prompt";
import { SongDocument } from "./SongDocument";
import { MidiControllerManager } from "./MidiController";

const { input, button, div, h2, select, option } = HTML;

export class MidiControllerPrompt implements Prompt {
	private _controllerSelect: HTMLSelectElement = select({ style: "width: 100%;" },
		option({ value: "option1" }, "Option Number One"),
		option({ value: "option2" }, "Option Number Two"),
	);
	private readonly _cancelButton: HTMLButtonElement = button({ class: "cancelButton" });
	private readonly _okayButton: HTMLButtonElement = button({ class: "okayButton" });
	private readonly _snapNotesCheckbox: HTMLInputElement = input({ type: "checkbox", style: "width: 1em; padding: 0; margin-right: 4em;" });
	
	public container: HTMLDivElement/* = div({ class: "prompt noSelection", style: "width: 250px;" },
		h2("Set Controller"),
		div({ style: "display: flex; flex-direction: row; align-items: center; height: 2em; justify-content: flex-end;" },
			div({ class: "selectContainer", style: "width: 100%;" }, this._controllerSelect),
		),
		div({ style: "display: flex; flex-direction: row-reverse; justify-content: space-between;" },
			this._okayButton,
		),
		this._snapNotesCheckbox,
		this._cancelButton,
	);*/;
	
	private updateContainer()
	{
		this.container = div({ class: "prompt noSelection", style: "width: 250px;" },
			h2("Set Midi Controller"),
			div({ style: "display: flex; flex-direction: row; align-items: center; height: 2em; justify-content: flex-end;" },
				div({ class: "selectContainer", style: "width: 100%;" }, this._controllerSelect),
			),
			div({ style: "display: flex; flex-direction: row; align-items: right; height: 2em; justify-content: flex-end;" },
				div({ style: "text-align: right;" },
					"Snap Notes:",
				),
				this._snapNotesCheckbox,
			),
			div({ style: "display: flex; flex-direction: row-reverse; justify-content: space-between;" },
				this._okayButton,
			),
			this._cancelButton,
		);
	}
	
	// Used to store state across sessions
	private readonly _lastController: string | null = window.localStorage.getItem("midiController");
	
	constructor(private _doc: SongDocument, private _midi: MidiControllerManager) {
		this._okayButton.addEventListener("click", this._saveChanged);
		this._cancelButton.addEventListener("click", this._close);
		
		const newOptions: any[] = [];
		for (const op of this._midi.midiControllerOptions)
		{
			const selected = op.name == this._lastController;
			newOptions.push(new Option(op.name, op.id, selected, selected));
		}
		this.setOptions(newOptions);
		this.updateContainer();
		
		//this._controllerSelect.onchange = (ev) => this._midi.selectMIDIIn(ev);
	}
	
	public cleanUp = (): void => {
		this._okayButton.removeEventListener("click", this._saveChanged);
		this._cancelButton.removeEventListener("click", this._close);
		this._controllerSelect.onchange = null;
	}
	
	private _close = (): void => {
		this._doc.undo();
	}
	
	private _saveChanged = (): void => {
		const s = this._controllerSelect.options[this._controllerSelect.selectedIndex];
		this._midi.selectMIDIInFull(s.text, s.value);
		this._doc.prompt = null;
		this._doc.undo();
	};
	
	public setOptions(...options: any[]) {
		this._controllerSelect = select({ style: "width: 100%;" },
			options
		);
	}
}


