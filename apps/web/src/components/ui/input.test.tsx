/**
 * A number box replaces what it holds; a text box does not.
 *
 * Reported as "when i type a value in any box i want to see the typed value
 * not 0 first". Nearly every numeric field in this application is a controlled
 * input bound to a column that starts at zero, so every one of them opened with
 * a `0` in it, and the first digit typed landed beside that zero rather than
 * over it.
 *
 * Fixed in the shared input rather than in the thirty screens that use it, so a
 * field written next month gets it without anybody remembering to ask.
 */
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from './input';

function Box(props: Record<string, unknown>) {
  const [value, setValue] = useState((props.start as string) ?? '0');
  const { start: _start, ...rest } = props;
  return (
    <Input value={value} aria-label="Field"
      onChange={(e) => setValue(e.target.value)} {...rest} />
  );
}

const field = () => screen.getByLabelText('Field');

describe('typing into a number box', () => {
  it('replaces the zero rather than typing beside it', async () => {
    render(<Box inputMode="decimal" />);
    await userEvent.click(field());
    await userEvent.keyboard('45');
    expect(field()).toHaveValue('45');
  });

  it('replaces a rate that is already set', async () => {
    render(<Box inputMode="decimal" start="128.50" />);
    await userEvent.click(field());
    await userEvent.keyboard('96');
    expect(field()).toHaveValue('96');
  });

  it('does the same for a spinner field', async () => {
    render(<Box type="number" start="8" />);
    await userEvent.click(field());
    await userEvent.keyboard('10');
    expect(field()).toHaveValue(10);
  });

  it('leaves a second click alone, so a digit can be corrected', async () => {
    render(<Box inputMode="decimal" start="128.50" />);
    await userEvent.click(field());
    await userEvent.click(field());
    await userEvent.keyboard('{End}9');
    expect(field()).toHaveValue('128.509');
  });
});

describe('typing into a text box', () => {
  it('leaves what is there, because words are edited and not replaced', async () => {
    render(<Box start="Excavate footings" />);
    await userEvent.click(field());
    await userEvent.keyboard(' to grade');
    expect(field()).toHaveValue('Excavate footings to grade');
  });

  it('can still be asked for the number behavior outright', async () => {
    render(<Box start="120 * 4" selectOnFocus />);
    await userEvent.click(field());
    await userEvent.keyboard('96');
    expect(field()).toHaveValue('96');
  });

  it('can turn it off on a numeric field that wants a caret', async () => {
    render(<Box inputMode="decimal" start="128" selectOnFocus={false} />);
    await userEvent.click(field());
    await userEvent.keyboard('9');
    expect(field()).toHaveValue('1289');
  });
});

describe('what the box was already asked to do', () => {
  it('still runs the caller\'s own focus and mouse handlers', async () => {
    const onFocus = vi.fn();
    const onMouseDown = vi.fn();
    const onMouseUp = vi.fn();
    render(<Box inputMode="decimal" onFocus={onFocus}
      onMouseDown={onMouseDown} onMouseUp={onMouseUp} />);
    await userEvent.click(field());
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onMouseDown).toHaveBeenCalledOnce();
    expect(onMouseUp).toHaveBeenCalledOnce();
  });
});
