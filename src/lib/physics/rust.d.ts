/* eslint-disable @typescript-eslint/no-explicit-any */
export default function init(input?: any): Promise<any>;
export function initSync(input: any): any;
export function init_panic_hook(): void;
export function process_single_tick(state_json: string, input_json: string): any;
export function process_single_tick_value(state: any, input: any): any;
export function create_default_game_state(): any;
export const GameMechanicsEngine: any;
export const MultiPlayerEngine: any;
