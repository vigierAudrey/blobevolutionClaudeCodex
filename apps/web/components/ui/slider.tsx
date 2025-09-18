"use client";

import * as React from 'react';

interface SliderProps {
  min: number;
  max: number;
  step?: number;
  defaultValue?: number[];
  onValueChange?: (values: number[]) => void;
}

export function Slider({ min, max, step = 1, defaultValue = [min], onValueChange }: SliderProps) {
  const [value, setValue] = React.useState(defaultValue[0] ?? min);

  React.useEffect(() => {
    setValue(defaultValue[0] ?? min);
  }, [defaultValue, min]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    setValue(next);
    onValueChange?.([next]);
  };

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={handleChange}
      className="w-full"
    />
  );
}
