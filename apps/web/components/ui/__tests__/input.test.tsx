import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Input } from '../input';

describe('Input', () => {
  it('applies base styles and merges className', () => {
    render(<Input placeholder="Name" className="extra" />);

    const input = screen.getByPlaceholderText('Name');
    expect(input).toHaveClass('border-input');
    expect(input).toHaveClass('extra');
  });

  it('forwards refs', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('fires change handler', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<Input placeholder="Email" onChange={onChange} />);

    await user.type(screen.getByPlaceholderText('Email'), 'test');
    expect(onChange).toHaveBeenCalled();
  });
});
