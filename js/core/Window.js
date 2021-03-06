/**
 * Window responsible for displaying the experiment stimuli
 * 
 * @author Alain Pitiot
 * @version 3.2.0
 * @copyright (c) 2019 Ilixa Ltd. ({@link http://ilixa.com})
 * @license Distributed under the terms of the MIT License
 */

import { Color } from '../util/Color';
import { PsychObject } from '../util/PsychObject';
import { MonotonicClock } from '../util/Clock';

/**
 * <p>Window displays the various stimuli of the experiment.</p>
 * <p>It sets up a [PIXI]{@link http://www.pixijs.com/} renderer, which we use to render the experiment stimuli.</p>
 * 
 * @name module:core.Window
 * @class
 * @extends PsychObject
 * @param {Object} options
 * @param {PsychoJS} options.psychoJS - the PsychoJS instance
 * @param {string} [options.name] the name of the window
 * @param {boolean} [options.fullscr= false] whether or not to go fullscreen
 * @param {Color} [options.color= Color('black')] the background color of the window
 * @param {string} [options.units= 'pix'] the units of the window
 * @param {boolean} [options.waitBlanking= false] whether or not to wait for all rendering operations to be done
 * before flipping
 * @param {boolean} [options.autoLog= true] whether or not to log
 */
export class Window extends PsychObject {

	/**
	 * Getter for monitorFramePeriod.
	 * 
	 * @name module:core.Window#monitorFramePeriod
	 * @function
	 * @public
	 */
	get monitorFramePeriod() { return this._monitorFramePeriod; }

	constructor({
		psychoJS,
		name,
		fullscr = false,
		color = new Color('black'),
		units = 'pix',
		waitBlanking = false,
		autoLog = true
	} = {}) {
		super(psychoJS, name);

		// messages to be logged at the next "flip":
		this._msgToBeLogged = [];

		// list of all elements, in the order they are currently drawn:
		this._drawList = [];

		this._addAttributes(Window, fullscr, color, units, waitBlanking, autoLog);
		this._addAttribute('size', []);


		// setup PIXI:
		this._setupPixi();

		// monitor frame period:
		this._monitorFramePeriod = 1.0 / this.getActualFrameRate();

		this._frameCount = 0;

		this._flipCallbacks = [];

		/*if (autoLog)
			logging.exp("Created %s = %s" % (self.name, str(self)));*/
	}


	/**
	 * Close the window.
	 * 
	 * <p> Note: this actually only removes the canvas used to render the experiment stimuli.</p>
	 * 
	 * @name module:core.Window#close
	 * @function
	 * @public
	 */
	close() {
		if (document.body.contains(this._renderer.view))
			document.body.removeChild(this._renderer.view);

		window.removeEventListener('resize', this._resizeCallback);
		window.removeEventListener('orientationchange', this._resizeCallback);
	}


	/**
	 * Estimate the frame rate.
	 * 
	 * @name module:core.Window#getActualFrameRate
	 * @function
	 * @public
	 * @return {number} always returns 60.0 at the moment
	 * 
	 * @todo estimate the actual frame rate.
	 */
	getActualFrameRate() {
		// TODO
		return 60.0;
	}


	/**
	 * Take the browser full screen if possible.
	 * 
	 * @name module:core.Window#adjustScreenSize
	 * @function
	 * @public
	 */
	adjustScreenSize() {
		// the following does not seem to work any longer (08.2019) on Google Chrome, there does not seem to be
		// reliable ways to test whether the window is already fullscreen.
		// this._windowAlreadyInFullScreen = (!window.screenTop && !window.screenY);
		this._windowAlreadyInFullScreen = false;

		if (this.fullscr && !this._windowAlreadyInFullScreen) {
			this._psychoJS.logger.debug('Resizing Window: ', this._name, 'to full screen.');

			if (typeof document.documentElement.requestFullscreen === 'function')
				document.documentElement.requestFullscreen();
			else if (typeof document.documentElement.mozRequestFullScreen === 'function')
				document.documentElement.mozRequestFullScreen();
			else if (typeof document.documentElement.webkitRequestFullscreen === 'function')
				document.documentElement.webkitRequestFullscreen();
			else if (typeof document.documentElement.msRequestFullscreen === 'function')
				document.documentElement.msRequestFullscreen();
			else
				this.psychoJS.logger.warn('Unable to go fullscreen.');

			// the Window and all of the stimuli need to be updated:
			this._needUpdate = true;
			for (const stimulus of this._drawList)
				stimulus._needUpdate = true;
		}
	}


	/**
	 * Take the browser back from full screen if needed.
	 *
	 * @name module:core.Window#closeFullScreen
	 * @function
	 * @public
	 */
	closeFullScreen() {
		// if the window was already full screen before we started the study, we don't close
		// full screen:
		if (this._windowAlreadyInFullScreen)
			return;

		// if the window is already back from full screen, we do nothing
		const windowInFullScreen = (!window.screenTop && !window.screenY);
		if (this.fullscr && windowInFullScreen) {
			this._psychoJS.logger.debug('Resizing Window: ', this._name, 'back from full screen.');

			if (typeof document.exitFullscreen === 'function')
				document.exitFullscreen();
			else if (typeof document.mozCancelFullScreen === 'function')
				document.mozCancelFullScreen();
			else if (typeof document.webkitExitFullscreen === 'function')
				document.webkitExitFullscreen();
			else if (typeof document.msExitFullscreen === 'function')
				document.msExitFullscreen();
		}

	}


	/**
	 * Log a message.
	 * 
	 * <p> Note: the message will be time-stamped at the next call to requestAnimationFrame.</p>
	 * 
	 * @name module:core.Window#logOnFlip
	 * @function
	 * @public
	 * @param {Object} options
	 * @param {String} options.msg the message to be logged
	 * @param {integer} level the log level
	 * @param {Object} [obj] the object associated with the message
	 */
	logOnFlip({ msg, level, obj} = {}) {
		this._msgToBeLogged.push({ msg, level, obj });
	}


	/**
	 * Callback function for callOnFlip.
	 *
	 * @callback module:core.Window~OnFlipCallback
	 * @param {*} [args] optional arguments
	 */
	/**
	 * Add a callback function that will run after the next screen flip, i.e. immediately after the next rendering of the
	 * Window.
	 * 
	 * <p>This is typically used to reset a timer or clock.</p>
	 * 
	 * @name module:core.Window#callOnFlip
	 * @function
	 * @public
	 * @param {module:core.Window~OnFlipCallback} flipCallback - callback function.
	 * @param {...*} flipCallbackArgs - arguments for the callback function.
	 */
	callOnFlip(flipCallback, ...flipCallbackArgs) {
		this._flipCallbacks.push({function: flipCallback, arguments: flipCallbackArgs});
	}


	/**
	 * Render the stimuli onto the canvas.
	 * 
	 * @name module:core.Window#render
	 * @function
	 * @public
	 */
	render() {
		this._frameCount++;

		// render the PIXI container:
		this._renderer.render(this._rootContainer);

		// this is to make sure that the GPU is done rendering, it may not be necessary
		// [http://www.html5gamedevs.com/topic/27849-detect-when-view-has-been-rendered/]
		this._renderer.gl.readPixels(0, 0, 1, 1, this._renderer.gl.RGBA, this._renderer.gl.UNSIGNED_BYTE, new Uint8Array(4));

		// blocks execution until the rendering is fully done:
		if (this._waitBlanking)
			this._renderer.gl.finish();

		// log:
		this._writeLogOnFlip();

		// call the callOnFlip functions and remove them:
		for (let callback of this._flipCallbacks)
			callback['function'](...callback['arguments']);
		this._flipCallbacks = [];

		// prepare the scene for the next animation frame:
		this._refresh();
	}


	/**
	 * Update this window, if need be.
	 * 
	 * @name module:core.Window#_updateIfNeeded
	 * @function
	 * @private
	 */
	_updateIfNeeded() {
		if (this._needUpdate) {
			this._renderer.backgroundColor = this._color.int;
			// we also change the background color of the body since the dialog popup may be longer than the window's height:
			document.body.style.backgroundColor = this._color.hex;

			this._needUpdate = false;
		}
	}


	/**
	 * Recompute this window's draw list and _container children for the next animation frame.
	 * 
	 * @name module:core.Window#_refresh
	 * @function
	 * @private
	 */
	_refresh() {
		this._updateIfNeeded();

		// if a stimuli needs to be updated, we remove it from the window container, update it, then put it back
		for (const stimulus of this._drawList)
			if (stimulus._needUpdate && typeof stimulus._pixi !== 'undefined') {
				this._rootContainer.removeChild(stimulus._pixi);
				stimulus._updateIfNeeded();
				this._rootContainer.addChild(stimulus._pixi);
			}
	}


	/**
	 * Force an update of all stimuli in this window's drawlist.
	 *
	 * @name module:core.Window#_fullRefresh
	 * @function
	 * @private
	 */
	_fullRefresh() {
		this._needUpdate = true;

		for (const stimulus of this._drawList)
			stimulus.refresh();

		this._refresh();
	}


	/**
	 * Setup PIXI.
	 * 
	 * <p>A new renderer is created and a container is added to it. The renderer's touch and mouse events are handled by the {@link EventManager}.</p>
	 * 
	 * @name module:core.Window#_setupPixi
	 * @function
	 * @private
	 */
	_setupPixi() {
		// the size of the PsychoJS Window is always that of the browser
		this._size[0] = window.innerWidth;
		this._size[1] = window.innerHeight;

		// create a PIXI renderer and add it to the document:
		this._renderer = PIXI.autoDetectRenderer(this._size[0], this._size[1], {
			backgroundColor: this.color.int
		});
		this._renderer.view.style.transform = 'translatez(0)';
		this._renderer.view.style.position = 'absolute';
		document.body.appendChild(this._renderer.view);

		// we also change the background color of the body since the dialog popup may be longer than the window's height:
		document.body.style.backgroundColor = this._color.hex;

		// create a top-level PIXI container:
		this._rootContainer = new PIXI.Container();
		this._rootContainer.interactive = true;

		// set the initial size of the PIXI renderer and the position of the root container:
		Window._resizePixiRenderer(this);

		// touch/mouse events are treated by PsychoJS' event manager:
		this.psychoJS.eventManager.addMouseListeners(this._renderer);

		// update the renderer size and the Window's stimuli whenever the browser's size or orientation change:
		this._resizeCallback = (e) => {
			Window._resizePixiRenderer(this, e);
			this._fullRefresh();
		};
		window.addEventListener('resize', this._resizeCallback);
		window.addEventListener('orientationchange', this._resizeCallback);
	}


	/**
	 * Adjust the size of the renderer and the position of the root container
	 * in response to a change in the browser's size.
	 *
	 * @name module:core.Window#_resizePixiRenderer
	 * @function
	 * @private
	 * @param {module:core.Window} pjsWindow - the PsychoJS Window
	 * @param event
	 */
	static _resizePixiRenderer(pjsWindow, event) {
		pjsWindow._psychoJS.logger.debug('resizing Window: ', pjsWindow._name, 'event:', JSON.stringify(event));

		// update the size of the PsychoJS Window:
		pjsWindow._size[0] = window.innerWidth;
		pjsWindow._size[1] = window.innerHeight;

		// update the PIXI renderer:
		pjsWindow._renderer.view.style.width = pjsWindow._size[0] + 'px';
		pjsWindow._renderer.view.style.height = pjsWindow._size[1] + 'px';
		pjsWindow._renderer.view.style.left = '0px';
		pjsWindow._renderer.view.style.top = '0px';
		pjsWindow._renderer.resize(pjsWindow._size[0], pjsWindow._size[1]);

		// setup the container such that (0,0) is at the centre of the window
		// with positive coordinates to the right and top:
		pjsWindow._rootContainer.position.x = pjsWindow._size[0] / 2.0;
		pjsWindow._rootContainer.position.y = pjsWindow._size[1] / 2.0;
		pjsWindow._rootContainer.scale.y = -1;
	}


	/**
	 * Send all logged messages to the {@link Logger}.
	 * 
	 * @name module:core.Window#_writeLogOnFlip
	 * @function
	 * @private
	 */
	_writeLogOnFlip() {
		var logTime = MonotonicClock.getReferenceTime();
		for (var i = 0; i < this._msgToBeLogged.length; ++i) {
			var entry = this._msgToBeLogged[i];
			this._psychoJS.logger.log(entry.msg, entry.level, logTime, entry.obj);
		}

		this._msgToBeLogged = [];
	}

}
