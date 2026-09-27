// Camera-only CI harness; production uses expo-router/entry.
import { registerRootComponent } from 'expo';
import App from './CameraSmokeApp';
registerRootComponent(App);
