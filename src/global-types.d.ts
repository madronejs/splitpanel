declare module '*.vue' {
  import { defineComponent } from 'vue';

  const Component: ReturnType<typeof defineComponent<any>>;
  export default Component;
}
