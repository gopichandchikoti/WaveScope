package com.portfolio.wavescope;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
@Override public void onCreate(Bundle savedInstanceState) {
registerPlugin(LocalVaultPlugin.class);
registerPlugin(NetworkToolsPlugin.class);
super.onCreate(savedInstanceState);
}
}
