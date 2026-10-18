<script lang="ts">
	import { chordParts } from '../../lib/keys';

	/** A key chord as key caps: Ctrl Shift S */
	interface Props {
		chord: string;
		mac: boolean;
	}

	let { chord, mac }: Props = $props();
</script>

<span class="chord">{#each chordParts(chord, mac) as part, i (i)}<kbd>{part}</kbd>{/each}</span>

<style>
	.chord {
		display: inline-flex;
		gap: 3px;
		align-items: baseline;
		white-space: nowrap;
	}
	kbd {
		font-family: var(--ox-font-ui);
		font-size: 11px;
		padding: 0 5px;
		border: 1px solid var(--ox-rule-strong);
		border-bottom-width: 2px;
		border-radius: 3px;
		background: var(--ox-raised);
		color: var(--ox-frost);
		line-height: 17px;
	}
</style>
