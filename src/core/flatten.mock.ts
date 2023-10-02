import type { SplitPanelDef } from './defs';

export const examplePanel1: SplitPanelDef = {
  id: 'test1',
  children: [
    {
      id: 'test1-child1',
      children: [
        {
          id: 'test1-child1-child1',
        },
        {
          id: 'test1-child1-child2',
        },
      ],
    },
    {
      id: 'test1-child2',
    },
    {
      id: 'test1-child3',
      children: [
        {
          id: 'test1-child3-child1',
        },
        {
          id: 'test1-child3-child2',
        },
      ],
    },
  ],
};
