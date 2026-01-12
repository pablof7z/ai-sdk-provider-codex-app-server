/**
 * Session - provides mid-execution control for Codex app-server turns
 *
 * The Session object is exposed via the `onSessionCreated` callback and provides
 * methods for injecting messages mid-execution and interrupting active turns.
 */

import type { AppServerClient } from './app-server-client.js';
import type { Session as ISession, UserInput } from './types/index.js';
import type { ProtocolUserInput } from './protocol/index.js';

/**
 * Convert public UserInput type to protocol format
 */
function toProtocolInput(input: UserInput): ProtocolUserInput {
  switch (input.type) {
    case 'text':
      return { type: 'text', text: input.text };
    case 'image':
      return { type: 'image', imageUrl: input.imageUrl };
    case 'localImage':
      return { type: 'localImage', path: input.path };
  }
}

/**
 * Session implementation for mid-execution control
 */
export class SessionImpl implements ISession {
  private _turnId: string | null = null;
  private _isActive = false;

  constructor(
    private client: AppServerClient,
    public readonly threadId: string
  ) {}

  get turnId(): string | null {
    return this._turnId;
  }

  isActive(): boolean {
    return this._isActive;
  }

  /**
   * Called internally when a turn starts
   */
  _setTurnId(turnId: string): void {
    this._turnId = turnId;
    this._isActive = true;
  }

  /**
   * Called internally when a turn completes
   */
  _setInactive(): void {
    this._isActive = false;
  }

  /**
   * Inject a message into the active execution.
   *
   * If a turn is currently active, the message is queued in the pending input buffer
   * and will be consumed at the next checkpoint in the model interaction loop.
   *
   * If no turn is active, a new turn is started with this message.
   *
   * @param content - String message or array of UserInput objects
   */
  async injectMessage(content: string | UserInput[]): Promise<void> {
    const inputs: UserInput[] =
      typeof content === 'string' ? [{ type: 'text', text: content }] : content;

    const protocolInputs = inputs.map(toProtocolInput);

    // Always use turn/start - the app-server will queue the input if a turn is active
    const result = await this.client.startTurn({
      threadId: this.threadId,
      input: protocolInputs,
    });

    // Update turn state if we got a new turn
    if (result.turn.id !== this._turnId) {
      this._turnId = result.turn.id;
      this._isActive = true;
    }
  }

  /**
   * Interrupt the current turn if one is active.
   */
  async interrupt(): Promise<void> {
    if (!this._isActive || !this._turnId) {
      return; // Nothing to interrupt
    }

    await this.client.interruptTurn({
      threadId: this.threadId,
      turnId: this._turnId,
    });

    this._isActive = false;
  }
}
