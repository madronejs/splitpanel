import { describe, expect, it } from 'vitest';

import { examplePanel1 } from './flatten.mock';
import SplitPanel from '../SplitPanel';

describe('rawDefinition', () => {
  it('can output a normalized configuration for the current panel', () => {
    const splitPanel = SplitPanel.create({
      ...examplePanel1,
      observe: false,
    });

    expect(splitPanel.getRawDefinition()).toEqual(examplePanel1);
  });

  it('outputs the changed id if setId was called on the root', () => {
    const splitPanel = SplitPanel.create({
      ...examplePanel1,
      observe: false,
    });

    splitPanel.setId('foobar');

    expect(splitPanel.getRawDefinition()).toEqual({
      ...examplePanel1,
      id: 'foobar',
    });
  });
});
