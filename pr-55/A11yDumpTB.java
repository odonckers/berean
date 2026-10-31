import android.app.UiAutomation;
import android.os.HandlerThread;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.lang.reflect.*;

// Prints every node of every window with its text, content description,
// selected state and accessibility action labels (which uiautomator dump omits).
public class A11yDumpTB {
  public static void main(String[] a) throws Exception {
    HandlerThread t = new HandlerThread("a11ydumptb"); t.start();
    Class<?> connC = Class.forName("android.app.UiAutomationConnection");
    Object conn = connC.getDeclaredConstructor().newInstance();
    Constructor<UiAutomation> ctor = UiAutomation.class.getDeclaredConstructor(android.os.Looper.class, Class.forName("android.app.IUiAutomationConnection"));
    ctor.setAccessible(true);
    UiAutomation ua = ctor.newInstance(t.getLooper(), conn);
    Method connect = UiAutomation.class.getDeclaredMethod("connect");
    connect.setAccessible(true); connect.invoke(ua);
    android.accessibilityservice.AccessibilityServiceInfo info = ua.getServiceInfo();
    // TalkBack view: no FLAG_INCLUDE_NOT_IMPORTANT_VIEWS, so views hidden with
    // importantForAccessibility no / no-hide-descendants are left out as TalkBack sees it.
    info.flags |= android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
    info.flags &= ~android.accessibilityservice.AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;
    ua.setServiceInfo(info);
    Thread.sleep(1500);
    for (AccessibilityWindowInfo w : ua.getWindows()) {
      System.out.println("WINDOW type=" + w.getType() + " title=" + w.getTitle());
      AccessibilityNodeInfo r = w.getRoot(); if (r != null) walk(r, 1);
    }
    Method disc = UiAutomation.class.getDeclaredMethod("disconnect"); disc.setAccessible(true); disc.invoke(ua);
    System.exit(0);
  }
  static void walk(AccessibilityNodeInfo n, int d) {
    StringBuilder s = new StringBuilder();
    CharSequence tx = n.getText(), cd = n.getContentDescription();
    StringBuilder acts = new StringBuilder();
    for (AccessibilityNodeInfo.AccessibilityAction ac : n.getActionList()) if (ac.getLabel() != null) acts.append(" [action: ").append(ac.getLabel()).append("]");
    if (tx != null || cd != null || acts.length() > 0 || n.isSelected()) {
      for (int i = 0; i < d; i++) s.append("  ");
      s.append(n.getClassName());
      if (tx != null) s.append(" text=\"").append(tx).append("\"");
      if (cd != null) s.append(" desc=\"").append(cd).append("\"");
      if (n.isClickable()) s.append(" clickable");
      if (!n.isImportantForAccessibility()) s.append(" NOT-IMPORTANT");
      if (n.isSelected()) s.append(" selected=true");
      s.append(acts);
      System.out.println(s);
    }
    for (int i = 0; i < n.getChildCount(); i++) { AccessibilityNodeInfo c = n.getChild(i); if (c != null) walk(c, d + 1); }
  }
}
