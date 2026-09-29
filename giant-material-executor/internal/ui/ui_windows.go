//go:build windows

package ui

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The Windows build intentionally uses the native user32 API instead of
// bundling a browser runtime. That keeps the downloaded executor small while
// still giving first-time users a real window for pairing.
// The message loop handles WM_COMMAND, and the pairing window is created with
// CreateWindowExW; ShowWindow is used for both normal launch and minimize.
const (
	wsOverlappedWindow = 0x00CF0000
	wsChild            = 0x40000000
	wsVisible          = 0x10000000
	wsBorder           = 0x00800000
	wsTabStop          = 0x00010000
	esAutoHScroll      = 0x00000080
	cwUseDefault       = 0x80000000
	swShow             = 5
	swMinimize         = 6
	wmDestroy          = 0x0002
	wmClose            = 0x0010
	wmCommand          = 0x0111
	wmTimer            = 0x0113
	wmApp              = 0x8000
	wmPairResult       = wmApp + 1
	wmTimerStatus      = 1

	controlEndpoint = 1001
	controlPairCode = 1002
	controlPair     = 1003
	controlMinimize = 1004
	controlStatus   = 1005
)

var (
	user32                   = windows.NewLazySystemDLL("user32.dll")
	procRegisterClassExW     = user32.NewProc("RegisterClassExW")
	procCreateWindowExW      = user32.NewProc("CreateWindowExW")
	procDefWindowProcW       = user32.NewProc("DefWindowProcW")
	procGetMessageW          = user32.NewProc("GetMessageW")
	procTranslateMessage     = user32.NewProc("TranslateMessage")
	procDispatchMessageW     = user32.NewProc("DispatchMessageW")
	procPostQuitMessage      = user32.NewProc("PostQuitMessage")
	procPostMessageW         = user32.NewProc("PostMessageW")
	procShowWindow           = user32.NewProc("ShowWindow")
	procUpdateWindow         = user32.NewProc("UpdateWindow")
	procSetWindowTextW       = user32.NewProc("SetWindowTextW")
	procGetWindowTextLengthW = user32.NewProc("GetWindowTextLengthW")
	procGetWindowTextW       = user32.NewProc("GetWindowTextW")
	procSetTimer             = user32.NewProc("SetTimer")
	procKillTimer            = user32.NewProc("KillTimer")
	procEnableWindow         = user32.NewProc("EnableWindow")
	procDestroyWindow        = user32.NewProc("DestroyWindow")
	procLoadCursorW          = user32.NewProc("LoadCursorW")
	kernel32                 = windows.NewLazySystemDLL("kernel32.dll")
	procGetModuleHandleW     = kernel32.NewProc("GetModuleHandleW")
)

type point struct {
	x int32
	y int32
}

type nativeMessage struct {
	hwnd    uintptr
	message uint32
	_       uint32 // MSG aligns wParam to 8 bytes on Windows x64.
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      point
}

type wndClassEx struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}

type winApp struct {
	hwnd     uintptr
	endpoint uintptr
	edit     uintptr
	status   uintptr
	bind     uintptr
	config   Config
	pairing  bool
	resultMu sync.Mutex
	pairErr  error
}

var activeWindow *winApp

func Run(ctx context.Context, config Config) error {
	if err := validateConfig(config); err != nil {
		return err
	}

	className, err := windows.UTF16PtrFromString("GiantMaterialExecutorWindow")
	if err != nil {
		return err
	}
	instance, _, _ := procGetModuleHandleW.Call(0)
	class := wndClassEx{
		cbSize:        uint32(unsafe.Sizeof(wndClassEx{})),
		lpfnWndProc:   windows.NewCallback(windowProc),
		hInstance:     instance,
		hCursor:       loadArrowCursor(),
		hbrBackground: 6, // COLOR_WINDOW + 1
		lpszClassName: className,
	}
	if atom, _, callErr := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&class))); atom == 0 && callErr != windows.ERROR_CLASS_ALREADY_EXISTS {
		return fmt.Errorf("register executor window class: %w", callErr)
	}

	title, _ := windows.UTF16PtrFromString("巨量素材执行器")
	hwnd, _, callErr := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(title)),
		wsOverlappedWindow,
		cwUseDefault,
		cwUseDefault,
		560,
		320,
		0,
		0,
		instance,
		0,
	)
	if hwnd == 0 {
		return fmt.Errorf("create executor window: %w", callErr)
	}

	app := &winApp{hwnd: hwnd, config: config}
	activeWindow = app
	app.createControls()
	app.refreshStatus()
	procShowWindow.Call(hwnd, swShow)
	procUpdateWindow.Call(hwnd)
	procSetTimer.Call(hwnd, wmTimerStatus, 1000, 0)

	go func() {
		<-ctx.Done()
		if activeWindow == app {
			procPostMessageW.Call(hwnd, wmClose, 0, 0)
		}
	}()

	var message nativeMessage
	for {
		result, _, getErr := procGetMessageW.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
		switch int32(result) {
		case -1:
			return fmt.Errorf("read executor window message: %w", getErr)
		case 0:
			activeWindow = nil
			return nil
		default:
			procTranslateMessage.Call(uintptr(unsafe.Pointer(&message)))
			procDispatchMessageW.Call(uintptr(unsafe.Pointer(&message)))
		}
	}
}

func loadArrowCursor() uintptr {
	const idcArrow = 32512
	cursor, _, _ := procLoadCursorW.Call(0, idcArrow)
	return cursor
}

func (app *winApp) createControls() {
	app.createControl("STATIC", "巨量素材执行器", 24, 20, 500, 28, 0, 0)
	app.createControl("STATIC", "控制服务地址（网页所在服务器）", 24, 54, 500, 22, 0, 0)
	app.endpoint = app.createControl("EDIT", app.config.PublicURL, 24, 78, 500, 30, wsChild|wsVisible|wsBorder|wsTabStop|esAutoHScroll, controlEndpoint)
	app.createControl("STATIC", "输入网页设置中生成的配对码，绑定后可长期后台运行。", 24, 116, 500, 22, 0, 0)
	app.edit = app.createControl("EDIT", "", 24, 148, 350, 30, wsChild|wsVisible|wsBorder|wsTabStop|esAutoHScroll, controlPairCode)
	app.bind = app.createControl("BUTTON", "绑定", 390, 148, 100, 30, wsChild|wsVisible|wsTabStop, controlPair)
	app.createControl("BUTTON", "最小化到后台", 24, 192, 130, 30, wsChild|wsVisible|wsTabStop, controlMinimize)
	app.status = app.createControl("STATIC", "正在启动…", 24, 238, 500, 42, 0, controlStatus)
}

func (app *winApp) createControl(className, text string, x, y, width, height int, style uint32, id int) uintptr {
	class, _ := windows.UTF16PtrFromString(className)
	caption, _ := windows.UTF16PtrFromString(text)
	hwnd, _, _ := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(class)),
		uintptr(unsafe.Pointer(caption)),
		uintptr(style),
		uintptr(x),
		uintptr(y),
		uintptr(width),
		uintptr(height),
		app.hwnd,
		uintptr(id),
		0,
		0,
	)
	return hwnd
}

func (app *winApp) onCommand(wParam uintptr) {
	id := int(uint32(wParam) & 0xffff)
	switch id {
	case controlPair:
		app.startPairing()
	case controlMinimize:
		procShowWindow.Call(app.hwnd, swMinimize)
	}
}

func (app *winApp) startPairing() {
	if app.pairing {
		return
	}
	endpoint := strings.TrimSpace(app.readControl(app.endpoint))
	if app.config.SetPublicURL != nil {
		if err := app.config.SetPublicURL(endpoint); err != nil {
			app.setStatus("控制服务地址无效：" + err.Error())
			return
		}
	}
	code := strings.TrimSpace(app.readEdit())
	if code == "" {
		app.setStatus("请输入网页设置中生成的配对码。")
		return
	}
	app.pairing = true
	procEnableWindow.Call(app.bind, 0)
	app.setStatus("正在绑定，请保持网络连接…\n地址：" + endpoint)
	go func() {
		pairCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		err := app.config.Pair(pairCtx, code)
		cancel()
		app.resultMu.Lock()
		app.pairErr = err
		app.resultMu.Unlock()
		procPostMessageW.Call(app.hwnd, wmPairResult, 0, 0)
	}()
}

func (app *winApp) onPairResult() {
	app.resultMu.Lock()
	err := app.pairErr
	app.pairErr = nil
	app.resultMu.Unlock()
	app.pairing = false
	procEnableWindow.Call(app.bind, 1)
	if err != nil {
		app.setStatus("绑定失败：" + err.Error())
		return
	}
	app.setEdit("")
	app.setStatus("绑定成功，执行器已在后台连接。")
}

func (app *winApp) refreshStatus() {
	snapshot := app.config.Snapshot()
	status := bindingStatusLabel(snapshot.BindingState)
	if snapshot.State != "" {
		status += " · " + string(snapshot.State)
	}
	if snapshot.ErrorMessage != "" {
		status += "\n" + snapshot.ErrorMessage
	}
	app.setStatus(status)
}

func (app *winApp) readControl(control uintptr) string {
	length, _, _ := procGetWindowTextLengthW.Call(control)
	if length == 0 {
		return ""
	}
	buffer := make([]uint16, int(length)+1)
	procGetWindowTextW.Call(control, uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)))
	return windows.UTF16ToString(buffer)
}

func (app *winApp) readEdit() string { return app.readControl(app.edit) }

func (app *winApp) setEdit(value string) {
	text, _ := windows.UTF16PtrFromString(value)
	procSetWindowTextW.Call(app.edit, uintptr(unsafe.Pointer(text)))
}

func (app *winApp) setStatus(value string) {
	text, _ := windows.UTF16PtrFromString(value)
	procSetWindowTextW.Call(app.status, uintptr(unsafe.Pointer(text)))
}

func windowProc(hwnd, message, wParam, lParam uintptr) uintptr {
	app := activeWindow
	switch uint32(message) {
	case wmCommand:
		if app != nil {
			app.onCommand(wParam)
		}
	case wmPairResult:
		if app != nil {
			app.onPairResult()
		}
	case wmTimer:
		if app != nil && wParam == wmTimerStatus {
			app.refreshStatus()
		}
	case wmClose:
		if app != nil && app.config.Shutdown != nil {
			app.config.Shutdown()
		}
		procDestroyWindow.Call(hwnd)
	case wmDestroy:
		procKillTimer.Call(hwnd, wmTimerStatus)
		procPostQuitMessage.Call(0)
	default:
		result, _, _ := procDefWindowProcW.Call(hwnd, message, wParam, lParam)
		return result
	}
	return 0
}
