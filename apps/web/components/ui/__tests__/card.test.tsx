import { render, screen } from '@testing-library/react';
import React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../card';

describe('Card components', () => {
  it('merges class names on Card', () => {
    render(<Card data-testid="card" className="custom" />);

    const card = screen.getByTestId('card');
    expect(card).toHaveClass('rounded-xl');
    expect(card).toHaveClass('custom');
  });

  it('renders composed layout pieces', () => {
    render(
      <Card>
        <CardHeader className="header-class">
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent className="content-class">Body</CardContent>
        <CardFooter className="footer-class">Footer</CardFooter>
      </Card>,
    );

    expect(screen.getByText('Title')).toHaveClass('text-2xl');
    expect(screen.getByText('Description')).toHaveClass('text-sm');
    expect(screen.getByText('Body')).toHaveClass('content-class');
    expect(screen.getByText('Footer')).toHaveClass('footer-class');
  });
});
