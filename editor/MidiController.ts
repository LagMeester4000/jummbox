/* source: https://github.com/cwilso/midi-synth/blob/master/js/midi.js */
// Library that makes the firefox plugin actually work:
//https://github.com/cwilso/WebMIDIAPIShim
//npm i --save web-midi-api

//import { doc, SongDocument } from "./main"
import { Config, Note, Pattern } from "../synth/synth";
import { ChangeSequence } from "./Change";
import { ChangeNoteAdded, ChangePatternSelection } from "./changes";
//import { ChangeSequence } from "./Change";
//import { ChangeNoteAdded, ChangePatternSelection } from "./changes";
import { SongDocument } from "./main"
import { PatternEditor } from "./PatternEditor";
//import 'web-midi-api'; // Breaks every build....


const PREFERRED_MIDI = [
  'mpk',
  'key',
  'piano',
];

const CMD_NOTE_OFF = 8;
const CMD_NOTE_ON = 9;
const CMD_AFTERTOUCH = 10;
const CMD_CC = 11;
const CMD_PITCHBEND = 14;
const NOTE_CC_MODWHEEL = 1;


type MidiControllerNote = {
	key: number,
	velocity: number,
	note: Note | null,
	pattern: Pattern | null,
};

type MidiControllerOption = {
	name: string,
	id: string,
};

const MAX_VOLUME = 6;

// REWRITE
export class MidiControllerManager
{
	//private selectMIDI: any = null;
	//private selectMIDI: HTMLSelectElement | null = null;
	private midiAccess: any = null;
	private midiIn: any = null;
	public midiControllerOptions: MidiControllerOption[] = [];
	
	constructor(private _doc: SongDocument, private _pat: PatternEditor)
	{
	}
	
	private midi_controller_keys_pressed = new Map<number, MidiControllerNote | null>();
	private midiSyncBuffer: MidiControllerNote[] = [];
	private minimalIsOwnNote: number = 10; // If the note is more than x% overlapped, it is a chord
	private snapEnabled = true;
	private snapRound = true;
	
	private syncUnsyncedChordNotes(self: MidiControllerNote, mapped: Note[], 
		ignoreList: Note[], outSyncedNotes: Note[], finishedNotes: MidiControllerNote[]): boolean
	{
		const selfStart = self.note?.start as number;
		const selfEnd = self.note?.end as number;
		const coll = this.findCollidingChordNotes(selfStart, selfEnd, mapped);
		if (this.allNotesSameStartEnd(coll))
		{
			ignoreList.push(self.note as Note);
			for (const c of coll) ignoreList.push(c);
			for (const c of coll) outSyncedNotes.push(c);
			
			const note = self.note as Note;
			for (const subNote of coll)
			{
				if (subNote == note) continue;
				note.pitches.push(subNote.pitches[0]);
			}
			finishedNotes.push(self);
			return true;
		}
		
		const newStart = self.note?.start as number;
		let newEnd = self.note?.end as number;
		for (const c of coll)
		{
			if (c == self.note) continue;
			if ((c.end as number) > newEnd)
			{
				newEnd = c.end as number;
			}
		}
		for (const c of coll)
		{
			c.start = newStart;
			c.end = newEnd;
		}
		return false;
	}
	
	private syncUnsyncedNoteBag(bag: MidiControllerNote[], 
		finishedNotes: MidiControllerNote[])
	{
		let ignoreList: Note[] = [];
		let sorted = bag.sort(
			(e1, e2) => (e1.note?.start as number) - (e2.note?.start as number));
		let mapped = bag.map((n) => n.note as Note);
		mapped = mapped.sort(
			(e1, e2) => (e1.start) - (e2.start));
		
		let previousSyncedNotes: Note[] = []; // Notes from the previous loop iteration
		let syncPole = 0;
		
		for (let self of sorted)
		{
			if (ignoreList.indexOf(self.note as Note) != -1) continue;
			
			// Sync previous notes to end before this one
			syncPole = self.note?.start as number;
			for (const n of previousSyncedNotes)
			{
				if (n.end > syncPole) n.end = syncPole;
			}
			previousSyncedNotes = [];
			
			const fatList = this.findCollidingChordNotes(
				self.note?.start as number, self.note?.end as number, mapped);
			if (fatList.length >= 2)
			{
				// This is a chord that needs to be fixed
				while (!this.syncUnsyncedChordNotes(self, mapped, 
					ignoreList, previousSyncedNotes, finishedNotes)) {}
			}
			else
			{
				// This not a chord, possibly an interaction between two notes
				const coll = this.findCollidingNotes(self.note?.start as number, 
					self.note?.end as number, mapped);
				
				if (coll.length >= 2)
				{
					// Not sure if this needs any code
				}
				
				previousSyncedNotes.push(self.note as Note);
				finishedNotes.push(self);
			}
		}
	
	}
	
	// TODO: make sure notes that are in different patterns aren't colliding
	private syncUnsyncedNotes()
	{
		let finishedNotes: MidiControllerNote[] = [];
		
		// Note snapping
		if (this.snapEnabled)
		{
			const snapDistance = Config.partsPerBeat / Config.rhythms[this._doc.song.rhythm].stepsPerBeat;
			const snapAdd = this.snapRound ? snapDistance / 2 : 0;
			for (const midiNote of this.midiSyncBuffer)
			{
				const note = midiNote.note as Note;
				note.start += snapAdd;
				note.start -= note.start % snapDistance;
				note.end += snapAdd;
				note.end -= note.end % snapDistance;
			}
		}
		
		// Sort notes into bags per pattern
		let bags = new Map<Pattern, MidiControllerNote[]>();
		for (let note of this.midiSyncBuffer)
		{
			let bag = bags.get(note.pattern as Pattern);
			if (bag == undefined)
			{
				bags.set(note.pattern as Pattern, []);
				bag = bags.get(note.pattern as Pattern);
			}
			bag?.push(note);
		}
		
		// Insert notes from actual pattern into bags
		for (const [key, value] of bags)
		{
			for (const note of key.notes)
			{
				const newMidiNote: MidiControllerNote = {
					key: note.pitches[0],
					velocity: 1,
					note: note.clone(), // TODO: Should this be a clone?
					pattern: key,
				};
				value.push(newMidiNote);
			}
		}
		
		// Sync notes from separate patterns individually
		for (const [_key, value] of bags)
		{
			this.syncUnsyncedNoteBag(value, finishedNotes);
		}
		
		// New sequence of changes
		const changeSequence = new ChangeSequence();
		changeSequence.append(new ChangePatternSelection(this._doc, 0, 0));
		
		// Clear old notes before readding them synced
		for (const [key, _value] of bags)
		{
			//key.notes = []; // Old
			for (let i = key.notes.length - 1; i >= 0; i--)
			{
				const note = key.notes[i];
				const remove = new ChangeNoteAdded(this._doc, key, note, i, true);
				changeSequence.append(remove);
			}
		}
		
		// Add all notes from midiSyncBuffer into the real buffers
		//for (const note of this.midiSyncBuffer)
		let patternSet = new Set<Pattern>();
		for (const note of finishedNotes)
		//for (let i = 0; i < finishedNotes.length; i++)
		{
			//const note = finishedNotes[i];
			if (note.note && note.pattern)
			{
				const recorded = note.note;
				const pattern = note.pattern;
				
				const newNote = new Note(-1, recorded.start, recorded.end, MAX_VOLUME);
				newNote.pitches = recorded.pitches.concat();
				if (!this.arePinsDefault(recorded))
				{
					newNote.pins = recorded.pins.concat();
					this.recalculatePins(newNote);
				}
				
				//pattern.notes.push(newNote); // Old
				if (newNote.start - newNote.end != 0) // TODO: should this actually be here
				{
					let j: number;
					for (j = 0; j < pattern.notes.length; j++) {
						if (pattern.notes[j].start >= newNote.end) break;
					}
					const add = new ChangeNoteAdded(this._doc, pattern, 
						//newNote, pattern.notes.length);
						newNote, j);
					changeSequence.append(add);
				}
			
				patternSet.add(pattern);
			}
		}
		
		// TEMP trying to remove this because it will mess with the indices
		/*
		for (const pat of patternSet)
		{
			pat.notes.sort((a, b) => a.start - b.start);
		}
		*/
		
		// Commit the changes
		this._doc.record(changeSequence);
		
		// Clear
		this.midiSyncBuffer = [];
	}
	
	private recalculatePins(note: Note)
	{
		let maxTime = note.pins[note.pins.length - 1].time;
		let newDuration = note.end - note.start;
		let scalar = newDuration / maxTime;
		for (const pin of note.pins)
		{
			pin.time *= scalar;
		}
	}
	
	private arePinsDefault(note: Note)
	{
		if (note.pins.length > 2) return false;
		for (const pin of note.pins)
		{
			if (pin.interval != 0) return false;
		}
		return true;
	}
	
	private allNotesSameStartEnd(notes: Note[]): boolean
	{
		if (notes.length <= 1) return true;
		let start = notes[0].start as number;
		let end = notes[0].end as number;
		for (let i = 1; i < notes.length; i++)
		{
			const n = notes[i];
			if ((n.start as number) != start ||
				(n.end as number) != end)
			{
				return false;
			}
		}
		return true;
	}
	
	private overlapPercentage(selfStart: number, selfEnd: number, 
		otherStart: number, otherEnd: number): number
	{
		let overlap = Math.min(Math.abs(selfStart - otherEnd), Math.abs(selfEnd - otherStart));
		const len = selfEnd - selfStart;
		if (overlap > len) overlap = len;
		return (overlap / len) * 100;
	}
	
	private findCollidingChordNotes(start: number, end: number, notes: Note[]): Note[]
	{
		let ret: Note[] = [];
		
		for (var note of notes)
		{
			if (note.start <= end && note.end >= start)
			{
				if (this.overlapPercentage(start, end, note.start, note.end) 
					>= 100 - this.minimalIsOwnNote)
				{
					ret.push(note);
				}
			}
		}
		
		return ret;
	}
	
	// Finds any notes that overlap with the given range
	private findCollidingNotes(start: number, end: number, notes: Note[]): Note[]
	{
		let ret: Note[] = [];
		
		for (var note of notes)
		{
			if (note.start <= end && note.end >= start)
			{
				ret.push(note);
			}
		}
		
		return ret;
	}
	
	noteOff(key: number)
	{
		//midi_controller_keys_pressed[key] = null;
		const deletingNote = this.midi_controller_keys_pressed.get(key);
		if (deletingNote)
		{
			if (deletingNote.note && deletingNote.pattern)
			{
				const recorded = deletingNote.note;
				//const pattern = deletingNote.pattern;
				const end: number = this._doc.synth.patternPlayheadPosition;
				if (end > recorded.start)
				{
					//recorded.end = end;
					const newNote = new Note(recorded.pitches[0], recorded.start, end, MAX_VOLUME);
					/*
					pattern.notes.push(newNote);
					
					const ind = pattern.notes.indexOf(recorded);
					if (ind > -1)
					{
						pattern.notes.splice(ind, 1);
					}
					*/
					deletingNote.note = newNote;
					this.midiSyncBuffer.push(deletingNote);
				}
				else if (end < recorded.start)
				{
					{
						const newNote = new Note(recorded.pitches[0], recorded.start, 
							this._doc.synth.patternEndPosition, MAX_VOLUME);
						deletingNote.note = newNote;
						this.midiSyncBuffer.push(deletingNote);
					}
					{
						const newNote = new Note(recorded.pitches[0], 0, 
							end, MAX_VOLUME);
						const newMidiNote: MidiControllerNote = {
							velocity: deletingNote.velocity,
							key: deletingNote.key,
							pattern: this._pat.pattern as Pattern,
							note: newNote,
						};
						this.midiSyncBuffer.push(newMidiNote);
					}
				}
			}
		}
		
		this.midi_controller_keys_pressed.set(key, null);
		
		let isEmpty = true;
		let keys: number[] = [];
		for (let [_key, value] of this.midi_controller_keys_pressed)
		{
			if (value != null)
			{
				isEmpty = false;
				keys.push(value.key);
			}
		}
		
		if (isEmpty)
		{
			//this._playedPitch = currentPitch;
			// Might need either of the following:
			this._doc.synth.liveInputDuration = 0;
			//this._doc.synth.liveInputPitches = keys;
			this._doc.synth.liveInputStarted = false;
			
			this.syncUnsyncedNotes();
		}
		else
		{
			//this._playedPitch = currentPitch;
			// Might need either of the following:
			//this._doc.synth.liveInputDuration = 0;
			this._doc.synth.liveInputPitches = keys;
			//this._doc.synth.liveInputStarted = false;
		}
		
		this._pat.highlightedNotes = keys;
		this._pat.render();
		
		console.log("DEPRESSED");
	}
	
	noteOn(key: number, vel: number)
	{
		// This fixes the live input bug, but causes issues, 
		//   like playing other synths as well as the main synth
		// Uhhh maybe that was caused by other instances of Jummbus running
		//   in the background...
		this._doc.synth.maintainLiveInput();
		console.log("PRESSED");
		
		let newKey: MidiControllerNote = {
			key: key,
			velocity: vel,
			note: null,
			pattern: null,
		};
		
		if (this._doc.synth.playing)
		{
			const begin: number = this._doc.synth.patternPlayheadPosition;
			const note: Note = new Note(key, begin, begin + 10, 5, false);
			//this._pat.pattern?.notes.push(note); // TEMP disabled
			newKey.note = note;
			newKey.pattern = this._pat.pattern as Pattern;
		}
		
		//midi_controller_keys_pressed[key] = newKey;
		this.midi_controller_keys_pressed.set(key, newKey);
		
		let keys: number[] = [];
		for (let [_key, value] of this.midi_controller_keys_pressed)
		{
			if (value != null)
			{
				keys.push(value.key);
			}
		}
		
		this._doc.synth.liveInputDuration = Number.MAX_SAFE_INTEGER;
		this._doc.synth.liveInputPitches = keys;
		this._doc.synth.liveInputStarted = true;
		
		this._pat.highlightedNotes = keys;
		this._pat.render();
	}
	
	controller(key: number, vel: number) {}
	pitchWheel(value: number) {}
	modWheel(value: number) {}
	polyPressure(key: number, vel: number) {}
	
	public midiControllerKeyPressed(key: number): boolean
	{
		if (key in this.midi_controller_keys_pressed)
		{
			//let v = midi_controller_keys_pressed[key];
			let v = this.midi_controller_keys_pressed.get(key);
			if (v != null)
			{
				return true;
			}
		}
		return false;
	}
	
	midiMessageReceived(ev: any) {
		let cmd = ev.data[0] >> 4;
		let channel = ev.data[0] & 0xf;
		let noteNumber = ev.data[1];
		let velocity = ev.data[2];
		
		if (channel === 9) return;
		if (cmd === CMD_NOTE_OFF || (cmd === CMD_NOTE_ON && velocity === 0)) {
			// with MIDI, note on with velocity zero is the same as note off
			// note off
			this.noteOff(noteNumber);
		} else if (cmd === CMD_NOTE_ON) {
			// note on
			this.noteOn(noteNumber, velocity / 127.0);
		} else if (cmd === CMD_CC) {
			if (noteNumber === NOTE_CC_MODWHEEL) {
			this.modWheel(velocity / 127.0);
			} else {
			this.controller(noteNumber, velocity / 127.0);
			}
		} else if (cmd === CMD_PITCHBEND) {
			// pitch wheel
			this.pitchWheel((velocity * 128.0 + noteNumber - 8192) / 8192.0);
		} else if (cmd === CMD_AFTERTOUCH) {
			// poly aftertouch
			this.polyPressure(noteNumber, velocity / 127);
		} else console.log('' + ev.data[0] + ' ' + ev.data[1] + ' ' + ev.data[2]);
	}
	
	selectMIDIIn(ev: any) {
		if (this.midiIn) this.midiIn.onmidimessage = null;
		let id = ev.target[ev.target.selectedIndex].value;
		if (typeof this.midiAccess.inputs === 'function')
			//Old Skool MIDI inputs() code
			this.midiIn = this.midiAccess.inputs()[ev.target.selectedIndex];
		else this.midiIn = this.midiAccess.inputs.get(id);
		if (this.midiIn) this.midiIn.onmidimessage = (e: any) => this.midiMessageReceived(e);
		
		//setSetting('midiIn', midiIn.name.toString());
	}
	
	private getMIDIDeviceIndex(midi: WebMidi.MIDIAccess, id: string): number
	{
		const inputs = midi.inputs.values();
		let index = 0;
		for (const input of inputs)
		{
			if (input.id == id)
			{
				return index;
			}
			index += 1;
		}
		return -1;
	}
	
	public selectMIDIInFull(name: string, id: string)
	{
		if (this.midiIn) this.midiIn.onmidimessage = null;
		
		if (typeof this.midiAccess.inputs === 'function')
		{
			this.midiIn = this.midiAccess.inputs()[this.getMIDIDeviceIndex(this.midiAccess, id)];
		}
		else
		{
			this.midiIn = this.midiAccess.inputs.get(id);
		}
		
		if (this.midiIn) this.midiIn.onmidimessage = (e: any) => this.midiMessageReceived(e);
		
		console.log(name + " : " + id);
		window.localStorage.setItem("midiController", name);
	}
	
	populateMIDIInSelect() {
		//const midiInSetting = getSetting('midiIn');
		//const midiInSetting = true;
		
		// clear the MIDI input select
		this.midiControllerOptions = [];
		//(this.selectMIDI as HTMLSelectElement).options.length = 0;
		if (this.midiIn && this.midiIn.state == 'disconnected') this.midiIn = null;
		let firstInput = null;
		
		let inputs = this.midiAccess.inputs.values();
		for (let input = inputs.next(); input && !input.done; input = inputs.next()) {
			input = input.value;
			const str = input.name.toString();
			
			if (!firstInput) {
				firstInput = input;
			}
			
			let preferred = false;
			
			if (this.midiIn && this.midiIn === input) {
				preferred = true;
			}
			
			//if (!midiIn && midiInSetting && str.toLowerCase().indexOf(midiInSetting.toLowerCase()) !== -1) {
			//  preferred = true;
			//}
			// TEMP
			//preferred = true;
			
			for (const pref of PREFERRED_MIDI) {
				if (!this.midiIn && str.toLowerCase().indexOf(pref) !== -1) {
					preferred = true;
				} 
			}
			
			//this.selectMIDI?.appendChild(
			//	new Option(input.name, input.id, preferred, preferred),
			//);
			this.midiControllerOptions.push({
				name: input.name,
				id: input.id,
			});
			
			if (preferred) {
				this.midiIn = input;
				this.midiIn.onmidimessage = (e: any) => this.midiMessageReceived(e);
			}
		}
		if (!this.midiIn) {
			this.midiIn = firstInput;
			if (this.midiIn) this.midiIn.onmidimessage = (e: any) => this.midiMessageReceived(e);
		}
	}
	
	midiConnectionStateChange(e: any) {
		console.log(`connection: ${e.port.name} ${e.port.connection} ${e.port.state}`);
		this.populateMIDIInSelect();
	}
	
	onMIDIStarted(midi: WebMidi.MIDIAccess) {
		this.midiAccess = midi;
		////setAppLoaded();
		//this.selectMIDI = document.getElementById('midiIn') as HTMLSelectElement;
		//this.selectMIDI.onchange = (ev) => this.selectMIDIIn(ev);
		////this.selectMIDI.onselectionchange = (ev) => this.selectMIDIIn(ev);
		midi.onstatechange = (ev) => this.midiConnectionStateChange(ev);
		this.populateMIDIInSelect();
		
		console.log("ADDED SOME MIDI DEVICES");
		console.log(this.midiIn);
		console.log(this.midiAccess);
		
		// Select default controller
		const def = window.localStorage.getItem("midiController");
		if (def)
		{
			for (const conch of this.midiControllerOptions)
			{
				if (conch.id == def)
				{
					this.selectMIDIInFull(conch.name, def);
					break;
				}
			}
		}
	}
	
	onMIDISystemError(err: any) {
		//setAppError('Cannot initialize MIDI');
		console.log(`MIDI not initialized - error encountered: ${err.code}`);
	}
	
	initializeMidi() {
		if (navigator.requestMIDIAccess) {
			//navigator.requestMIDIAccess().then(this.onMIDIStarted, this.onMIDISystemError);
			navigator.requestMIDIAccess().then((m) => this.onMIDIStarted(m), (e) => this.onMIDISystemError(e));
		} else {
			//setAppError('Your browser has no MIDI features.');
			console.log('Your browser has no MIDI features.');
		}
	}

}